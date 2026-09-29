#!/usr/bin/env node
/**
 * The chat client keeps chats, restores their history, queues sends and hands a chat between tabs,
 * and does all of it only where the tutor it talks to can.
 *
 * Owner ask, #lessons 1790645918.546949: resumable sessions, history on reopen, queued messages.
 * The client half is `_lesson-core/chat/tutorApi.js` (the contract and its feature detection) and
 * `chat/chatHistory.js` (history, queue, asks, export), wired in Chatbot.jsx. The dev proxy's half
 * is tests/proxy-persist.
 *
 * Node only. No npm install, no network, no browser. Every case builds its own stub fetch and
 * starts from a tutor nobody has probed (resetFeatures), so no case leans on another's state.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const CORE = path.join(SKILL, 'references', 'bootstrap', '_lesson-core');
const CHAT = path.join(CORE, 'chat');

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

// A fetch that answers from `routes` (url -> fn(body) -> {status, json|text}) and records calls.
function stubFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    const r = routes[url] ? routes[url](body) : { status: 404, text: 'not found' };
    const text = r.json !== undefined ? JSON.stringify(r.json) : (r.text || '');
    return {
      status: r.status, ok: r.status >= 200 && r.status < 300,
      json: async () => JSON.parse(text),
    };
  };
  f.calls = calls;
  return f;
}

(async () => {
  const api = await import(pathToFileURL(path.join(CHAT, 'tutorApi.js')).href);
  const hist = await import(pathToFileURL(path.join(CHAT, 'chatHistory.js')).href);
  const md = await import(pathToFileURL(path.join(CHAT, 'chatMarkdown.js')).href);

  heading(1, 'a restore with empty sessionStorage fetches the history and shows it under a divider');
  {
    api.resetFeatures();
    const sent = 'obs\n[ACTIVE CONTEXT]\nTopic: roots\n[/ACTIVE CONTEXT]\n\n[ANSWER STYLE: DIRECT -- set by the student]\nx\n[/ANSWER STYLE]\n[Context 1 -- eq]: f(x)\n\nQuestion: what is a root?';
    const pages = {
      undefined: { turns: [{ role: 'user', text: 'second', at: 3 }, { role: 'assistant', text: 'answer two', at: 4 }], more: true, before: 2 },
      2: { turns: [{ role: 'user', text: sent, at: 1 }, { role: 'assistant', text: 'answer one', at: 2 }], more: false, before: 0 },
    };
    const f = stubFetch({ '/session/history': (b) => ({ status: 200, json: pages[b.before] }) });
    check('empty sessionStorage and a server that took 2 questions needs history', hist.needsHistory([], { messageCount: 2 }) === true);
    check('a tab holding both questions does not', hist.needsHistory([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }], { messageCount: 2 }) === false);
    check('an unsent message is not one the server took', hist.needsHistory([{ role: 'user' }, { role: 'user', unsent: true }], { messageCount: 2 }) === true);
    const turns = await hist.fetchHistory({ fetchImpl: f, url: '/session/history', sessionId: 's1', limit: 2 });
    check('both pages are fetched, oldest first', JSON.stringify((turns || []).map(t => t.at)) === '[1,2,3,4]', JSON.stringify(turns));
    const msgs = hist.restoredMessages(turns);
    check('the divider comes first and says restored', msgs[0] && msgs[0].role === 'divider' && msgs[0].kind === 'restored', JSON.stringify(msgs[0]));
    check('the user turn shows only what was typed', msgs[1] && msgs[1].content === 'what is a root?', JSON.stringify(msgs[1]));
    check('four bubbles follow the divider', msgs.length === 5);
  }

  heading(2, 'a tutor with no history endpoint leaves the tab alone, and is not asked twice');
  {
    api.resetFeatures();
    const f = stubFetch({});
    const turns = await hist.fetchHistory({ fetchImpl: f, url: '/session/history', sessionId: 's1' });
    check('a plain-text 404 is an absent endpoint: null', turns === null);
    check('it is remembered as missing', api.isMissing('session/history'));
    await hist.fetchHistory({ fetchImpl: f, url: '/session/history', sessionId: 's1' });
    check('the second restore does not ask again', f.calls.length === 1, `${f.calls.length} calls`);
    api.resetFeatures();
    const g = stubFetch({ '/session/history': () => ({ status: 404, json: { error: { message: 'no such chat' } } }) });
    check('a JSON 404 is the endpoint speaking, not its absence', (await hist.fetchHistory({ fetchImpl: g, url: '/session/history', sessionId: 'x' })) === null && !api.isMissing('session/history'));
  }

  heading(3, 'queued sends keep the order they were typed in');
  {
    const queue = [
      { qkey: 'a', content: 'first', sendText: 'first' },
      { qkey: 'p', content: 'still posting', pending: true },
      { qkey: 'b', content: 'second', sendText: '[Context 1 -- eq]: f\n\nQuestion: second' },
      { qkey: 'c', content: 'third', sendText: 'third' },
      { qkey: 'x', content: 'refused', failed: 'API error (500)' },
    ];
    const { server, local } = hist.splitQueue(queue);
    check('pending and failed entries stay behind', local.map(q => q.qkey).join() === 'a,b,c' && server.length === 0);
    check('the merged message is in typed order', hist.mergeQueued(local) === 'first\n\n---\n\n[Context 1 -- eq]: f\n\nQuestion: second\n\n---\n\nthird');
    check('the bubbles are in typed order and carry no queue fields', JSON.stringify(hist.queuedBubbles(local)) === JSON.stringify([{ role: 'user', content: 'first' }, { role: 'user', content: 'second' }, { role: 'user', content: 'third' }]));
    const after = hist.dropQueued(queue, 'b');
    check('× removes only its own entry', after.map(q => q.qkey).join() === 'a,p,c,x');
    const mixed = hist.splitQueue([{ qkey: 'a', queueId: 'q1' }, { qkey: 'b' }, { qkey: 'c', queueId: 'live' }]);
    check('entries the tutor holds are told apart from ones this tab holds', mixed.server.map(q => q.qkey).join() === 'a,c' && mixed.local.map(q => q.qkey).join() === 'b');
  }

  heading(4, 'a ping says held, taken over, absent or unknown');
  {
    api.resetFeatures();
    const held = await api.callOptional(stubFetch({ '/p': () => ({ status: 200, json: { held: true, asks: [] } }) }), 'session/ping', '/p', { sessionId: 's', tabId: 't' });
    check('200 is held', api.pingOutcome(held) === 'held');
    const taken = await api.callOptional(stubFetch({ '/p': () => ({ status: 409, json: { error: { message: 'x' }, takenOver: true } }) }), 'session/ping', '/p', {});
    check('409 takenOver is taken: the tab goes read-only', api.pingOutcome(taken) === 'taken');
    const other = await api.callOptional(stubFetch({ '/p': () => ({ status: 409, json: { error: { message: 'busy' } } }) }), 'session/ping', '/p', {});
    check('a 409 that is not a takeover is not read as one', api.pingOutcome(other) === 'unknown');
    const down = await api.callOptional(async () => { throw new Error('offline'); }, 'session/ping', '/p', {});
    check('no answer is unknown, and not remembered as missing', api.pingOutcome(down) === 'unknown' && !api.isMissing('session/ping'));
    const old = await api.callOptional(stubFetch({}), 'session/ping', '/p', {});
    check('an older tutor with no ping is absent', api.pingOutcome(old) === 'absent' && api.isMissing('session/ping'));
    check('two page loads get two lease ids', api.newTabId() !== api.newTabId());
  }

  heading(5, 'the picker shows title, count and last use, newest first');
  {
    const now = Date.parse('2026-09-28T12:00:00Z');
    check('epoch seconds, ms and ISO all read', api.lastAtMs(now / 1000) === now && api.lastAtMs(now) === now && api.lastAtMs('2026-09-28T12:00:00Z') === now);
    check('absent reads as null', api.lastAtMs(undefined) === null && api.lastAtMs('junk') === null);
    check('five minutes ago', api.fmtAgo(now - 5 * 60000, now) === '5 min ago');
    check('the current minute is just now', api.fmtAgo(now - 59000, now) === 'just now' && api.fmtAgo(now - 60000, now) === '1 min ago');
    const sorted = api.sortForPicker([{ id: 'a', lastAt: 1 }, { id: 'b', lastAt: 3 }, { id: 'c' }, { id: 'd', lastAt: 2 }]);
    check('newest first, undated last', sorted.map(s => s.id).join() === 'b,d,a,c', sorted.map(s => s.id).join());
    const src = fs.readFileSync(path.join(CHAT, 'Chatbot.jsx'), 'utf8');
    check('the picker renders the title and last use', /chat-pick-title/.test(src) && /fmtAgo\(lastAtMs\(s\.lastAt\)\)/.test(src));
  }

  heading(6, 'closing keeps the chat; Delete is the only discard');
  {
    const src = fs.readFileSync(path.join(CHAT, 'Chatbot.jsx'), 'utf8');
    const closes = [...src.matchAll(/JSON\.stringify\(\{ sessionId: [^}]*keepContext: ([^ }]+) \}\)[^\n]*\n\s*navigator\.sendBeacon\(API\.sessionClose/g)].map(m => m[1]);
    check('both close beacons send keepContext: true', closes.length === 2 && closes.every(v => v === 'true'), JSON.stringify(closes));
    check('no close sends the tab\'s own keepContext any more', !/keepContext: tab\.keepContext/.test(src));
    const del = src.slice(src.indexOf('const deleteChat'), src.indexOf('const exportChat'));
    check('Delete asks session/delete and falls back to close keepContext:false', /API\.sessionDelete/.test(del) && /r\.absent/.test(del) && /keepContext: false/.test(del));
    check('the only keepContext:false outside Delete is a thread\'s own session', (src.split('keepContext: false').length - 1) === 2, 'count ' + (src.split('keepContext: false').length - 1));
  }

  heading(7, 'download chips, ask chips and export');
  {
    const html = md.renderChatHtml('Here: [the notes](chat/file/notes.pdf) and [evil](https://x.test/chat/file/a.pdf) and [page](chat/file/x.html)');
    check('a chat/file pdf link is a download chip', /<a class="chat-download-chip" href="chat\/file\/notes\.pdf"[^>]*>⤓ the notes <span class="chat-download-ext">PDF<\/span><\/a>/.test(html), html);
    check('an off-site link is not a chip', !/href="https:\/\/x\.test/.test(html));
    check('an html file is not a chip', !/chat\/file\/x\.html"/.test(html));
    let asks = hist.mergeAsks([], [{ id: 'a1', status: 'pending', text: 'q' }]);
    asks = hist.mergeAsks(asks, [{ id: 'a1', status: 'answered' }, { id: 'a2', status: 'bogus' }]);
    check('an ask chip moves on in place; an unknown status is ignored', asks.length === 1 && asks[0].status === 'answered' && asks[0].text === 'q', JSON.stringify(asks));
    const out = hist.chatToMarkdown({ title: 'Roots', exportedAt: 'T', messages: [
      { role: 'divider', content: 'Restored from the tutor' }, { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'see [n](chat/file/n.pdf)' }, { role: 'fold', content: 'skip' }, { role: 'assistant', content: 'part', stopped: true }] });
    check('export has the title, both speakers, the link, and marks a stop', /^# Roots/.test(out) && /\*\*You\*\*\n\nhi/.test(out) && /\(chat\/file\/n\.pdf\)/.test(out) && /_\(stopped\)_/.test(out) && !/skip/.test(out), out);
    check('the export name is safe', hist.exportName('Newton\'s method / roots?', 3) === 'newton-s-method-roots-3.md');
  }

  heading(8, 'every new endpoint is in the API list and feature-detected where it is called');
  {
    const build = fs.readFileSync(path.join(CORE, 'constants', 'build.js'), 'utf8');
    const src = fs.readFileSync(path.join(CHAT, 'Chatbot.jsx'), 'utf8') + fs.readFileSync(path.join(CHAT, 'chatHistory.js'), 'utf8');
    for (const [key, name] of [['sessionPing', 'session/ping'], ['sessionDelete', 'session/delete'], ['sessionHistory', 'session/history'], ['chatUnqueue', 'chat/unqueue']]) {
      check(`${name} is in API`, build.includes(`${key}: \`\${import.meta.env.BASE_URL}${name}\``));
      check(`${name} goes through callOptional`, new RegExp(`callOptional\\([^)]*"${name}"`).test(src));
    }
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
