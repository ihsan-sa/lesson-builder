#!/usr/bin/env node
/**
 * A tutor reply survives the tab losing its stream mid-turn, and two chats on one topic have
 * different tabs.
 *
 * Drives `references/bootstrap/_lesson-core/chat/turnStream.js` with a fake fetch and a stream
 * that dies part-way, and `tabLabel` in `chatState.js` with plain tab objects; then reads
 * `Chatbot.jsx` for the wiring. Node only: no npm install, no network, no browser.
 * Exit code 0 only when every check passes. What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const CHAT = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'chat');
const TURN_JS = path.join(CHAT, 'turnStream.js');
const STATE_JS = path.join(CHAT, 'chatState.js');
const CHATBOT_JSX = path.join(CHAT, 'Chatbot.jsx');

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function eq(what, got, want) {
  check(what, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

// One SSE frame as the tutor writes it.
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const REPLY = ['The derivative of x² ', 'is 2x — the slope ', 'of the tangent at x.'];
const WHOLE = REPLY.join('');
const TURN_SSE = [frame('status', { type: 'thinking' }), ...REPLY.map(t => frame('text', { text: t })),
  ': keepalive\n\n', frame('done', { text: WHOLE })].join('');

// A Response whose body yields `chunks`, then either ends or throws `dieWith` (a network drop).
function response(chunks, { status = 200, json = null, dieWith = null } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
          if (dieWith) throw dieWith;
          return { done: true, value: undefined };
        },
      }),
    },
  };
}
const networkDrop = () => new TypeError('network error');
const abort = () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; };

// A fake fetch that answers each call with the next response in `answers`, and records the calls.
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = answers.shift();
    if (!next) throw new Error('unexpected fetch');
    return typeof next === 'function' ? next() : next;
  };
  f.calls = calls;
  return f;
}

// The bubble as Chatbot keeps it: text() writes the streaming tail, restart() drops the half-built
// one (dropPartialTail), exactly what the component's handlers do to its messages array.
function bubble(T, messages) {
  const state = { messages: [...messages], restarts: 0 };
  state.on = {
    text: (t) => {
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && last._streaming) state.messages[state.messages.length - 1] = { role: 'assistant', content: t, _streaming: true };
      else state.messages.push({ role: 'assistant', content: t, _streaming: true });
    },
    restart: () => { state.restarts++; state.messages = T.dropPartialTail(state.messages); },
  };
  return state;
}

(async () => {
  const T = await import(pathToFileURL(TURN_JS).href);
  globalThis.window = {};
  const St = await import(pathToFileURL(STATE_JS).href);

  heading('1', 'a stream that dies mid-turn ends with the whole reply in the bubble');
  {
    const half = [frame('text', { text: REPLY[0] }), frame('text', { text: REPLY[1] }).slice(0, 12)];
    const fetchImpl = fakeFetch([response([TURN_SSE])]);
    const b = bubble(T, [{ role: 'user', content: 'what is d/dx x²?' }]);
    const turn = await T.readTurnWithReattach({
      res: response(half, { dieWith: networkDrop() }), fetchImpl, url: '/l/chat', sessionId: 'sid-1',
      on: b.on, pauseMs: 0,
    });
    eq('one attach, to the same endpoint', fetchImpl.calls.map(c => c.url), ['/l/chat']);
    eq('…asking for this chat\'s turn back', fetchImpl.calls[0].body, { sessionId: 'sid-1', attach: true });
    eq('the turn ends with the whole reply', turn.finalText, WHOLE);
    check('…settled by its done event', turn.doneReceived && !turn.errored && !turn.stopped);
    eq('the bubble was rebuilt once, from scratch', b.restarts, 1);
    eq('one reply bubble, holding the whole reply (not the half plus the whole)',
      b.messages.map(m => [m.role, m.content]), [['user', 'what is d/dx x²?'], ['assistant', WHOLE]]);
  }

  heading('2', 'our own abort is not a lost stream');
  {
    const fetchImpl = fakeFetch([]);
    let thrown = null;
    try {
      await T.readTurnWithReattach({ res: response([frame('text', { text: 'a' })], { dieWith: abort() }),
        fetchImpl, url: '/chat', sessionId: 'sid-1', pauseMs: 0 });
    } catch (e) { thrown = e; }
    eq('the AbortError comes back out', thrown && thrown.name, 'AbortError');
    eq('…and nothing asked to attach', fetchImpl.calls.length, 0);
    const again = fakeFetch([response([TURN_SSE])]);
    const t = await T.readTurnWithReattach({ res: response([], { dieWith: networkDrop() }),
      fetchImpl: again, url: '/chat', sessionId: 'sid-1', pauseMs: 0 });
    check('while a network drop on the same path does attach', again.calls.length === 1 && t.finalText === WHOLE);
    const none = fakeFetch([]);
    let e2 = null;
    try {
      await T.readTurnWithReattach({ res: response([], { dieWith: networkDrop() }), fetchImpl: none,
        url: '/chat', sessionId: null, pauseMs: 0 });
    } catch (e) { e2 = e; }
    check('no session id (a dev build) never attaches: the drop is thrown as before',
      none.calls.length === 0 && e2 instanceof TypeError);
  }

  heading('3', 'attach says no: 409 never asked, 404 not found');
  {
    for (const [status, json, want] of [
      [409, { error: { message: 'Nothing to attach to: this chat has not been asked anything yet.' } }, 'Nothing to attach to'],
      [404, { error: { message: 'Session not found. Create a new one.' } }, 'Session not found'],
      [409, null, 'Nothing to attach to'],
    ]) {
      const fetchImpl = fakeFetch([response([], { status, json })]);
      let e = null;
      try {
        await T.readTurnWithReattach({ res: response([], { dieWith: networkDrop() }), fetchImpl,
          url: '/chat', sessionId: 'sid-1', pauseMs: 0 });
      } catch (x) { e = x; }
      check(`${status}${json ? '' : ' with no body'} is an AttachRefused carrying the server's words`,
        e && e.name === 'AttachRefused' && e.status === status && e.message.startsWith(want), e && `${e.name} ${e.status} ${e.message}`);
    }
    const b = bubble(T, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'half', _streaming: true }]);
    try {
      await T.readTurnWithReattach({ res: response([], { dieWith: networkDrop() }),
        fetchImpl: fakeFetch([response([], { status: 404, json: {} })]), url: '/chat', sessionId: 's', on: b.on, pauseMs: 0 });
    } catch (_) {}
    check('a refused attach leaves the half-built bubble alone (nothing to rebuild it from)',
      b.restarts === 0 && b.messages.length === 2);
  }

  heading('4', 'a replay that dies too is asked again, a bounded number of times');
  {
    const dying = () => response([frame('text', { text: REPLY[0] })], { dieWith: networkDrop() });
    const fetchImpl = fakeFetch([dying, response([TURN_SSE])]);
    const b = bubble(T, [{ role: 'user', content: 'q' }]);
    const t = await T.readTurnWithReattach({ res: dying(), fetchImpl, url: '/chat', sessionId: 's', on: b.on, pauseMs: 0 });
    check('two attaches, then the whole reply', fetchImpl.calls.length === 2 && t.finalText === WHOLE);
    eq('…in one bubble', b.messages.filter(m => m.role === 'assistant').map(m => m.content), [WHOLE]);
    const forever = fakeFetch([dying, dying, dying, dying, dying]);
    let e = null;
    try {
      await T.readTurnWithReattach({ res: dying(), fetchImpl: forever, url: '/chat', sessionId: 's', tries: 3, pauseMs: 0 });
    } catch (x) { e = x; }
    check('a server that keeps dropping is asked `tries` times, then the drop is thrown',
      forever.calls.length === 3 && e instanceof TypeError, `${forever.calls.length} calls, ${e}`);
  }

  heading('5', 'the reader: comment lines, and an event split across chunks');
  {
    const text = [': keepalive\n\n', 'event: te', 'xt\ndata: {"text":"a', 'b"}\n\n', ': keepalive\n', '\n',
      frame('text', { text: 'c' }), frame('error', { message: 'credit' })];
    const t = await T.readTurn(response(text));
    check('a keepalive comment is dropped and a split event is kept; error ends the turn',
      t.finalText === 'credit' && t.errored && t.doneReceived, JSON.stringify(t));
    const seen = [];
    await T.readTurn(response(text), { text: (x) => seen.push(x) });
    eq('…text arrived as it streamed', seen, ['ab', 'abc']);
    const c = await T.readTurn(response([frame('text', { text: 'x' }), frame('cancelled', {})]));
    check('cancelled marks the turn stopped', c.stopped && c.doneReceived);
  }

  heading('6', 'a reloaded tab attaches only when it is missing the end of a turn');
  {
    const user = { role: 'user', content: 'q' };
    const done = { role: 'assistant', content: 'a' };
    const s = (turn, lastTurn) => ({ id: 's', turn, lastTurn });
    const finished = { msg: 2, outcome: 'done', at: 1 };
    check('a turn in flight: attach', T.needsAttach(s({ msg: 2, startedAt: 1 }, null), [user, done, user]) === true);
    check('…even if the saved tail looks answered', T.needsAttach(s({ msg: 3 }, finished), [user, done]) === true);
    check('finished, tail is the question: attach', T.needsAttach(s(null, finished), [user, done, user]) === true);
    check('finished, tail is a half bubble: attach',
      T.needsAttach(s(null, finished), [user, { role: 'assistant', content: 'ha', partial: true }]) === true);
    check('finished, tail is a lost-connection line: attach',
      T.needsAttach(s(null, finished), [user, { role: 'assistant', content: 'ha', partial: true },
        { role: 'assistant', content: 'Connection error: x', partial: true }]) === true);
    check('finished and answered: no attach', T.needsAttach(s(null, finished), [user, done]) === false);
    check('a fold card after the answer is not a question',
      T.needsAttach(s(null, finished), [user, done, { role: 'fold', content: 'f' }]) === false);
    check('cancelled (the student stopped it): no attach',
      T.needsAttach(s(null, { ...finished, outcome: 'cancelled' }), [user]) === false);
    check('never asked: no attach', T.needsAttach(s(null, null), []) === false);
    check('not listed: no attach', T.needsAttach(undefined, [user]) === false);
    const tail = [user, { role: 'assistant', content: 'h', partial: true }, { role: 'assistant', content: 'err', partial: true }];
    eq('dropPartialTail drops the half bubble and its error line', T.dropPartialTail(tail), [user]);
    const kept = [user, done];
    check('…and leaves an answered transcript as the same array', T.dropPartialTail(kept) === kept);
  }

  heading('7', 'two chats on one topic have different tabs');
  {
    check('chatState.js exports tabLabel', typeof St.tabLabel === 'function');
    const tabLabel = typeof St.tabLabel === 'function' ? St.tabLabel : (t) => t.title;
    const a = { ...St.makeTab('Derivatives'), chatNum: 3 };
    const b = { ...St.makeTab('Derivatives'), chatNum: 4 };
    const c = { ...St.makeTab('Limits'), chatNum: 5 };
    const tabs = [a, b, c];
    check('the two Derivatives tabs differ', tabLabel(a, tabs) !== tabLabel(b, tabs),
      `${tabLabel(a, tabs)} / ${tabLabel(b, tabs)}`);
    eq('…each named by topic and chat number', [tabLabel(a, tabs), tabLabel(b, tabs)], ['Derivatives #3', 'Derivatives #4']);
    eq('a topic only one tab has keeps its plain label', tabLabel(c, tabs), 'Limits');
    eq('alone, a tab is just its topic', tabLabel(a, [a]), 'Derivatives');
    eq('no topic: the chat number', tabLabel({ ...St.makeTab(''), chatNum: 7 }, []), 'Chat 7');
    eq('no topic, no number yet', tabLabel(St.makeTab(''), []), 'New chat');
  }

  heading('8', 'Chatbot.jsx is wired to it');
  {
    const src = fs.readFileSync(CHATBOT_JSX, 'utf8');
    check('imports the reader from turnStream.js', src.includes('from "./turnStream.js"'));
    check('a sent message reads through readTurnWithReattach, with the tab\'s session',
      /await readTurnWithReattach\(\{[\s\S]{0,200}sessionId: ATTACH_ENABLED \? tab\.sessionId : null/.test(src));
    check('no read loop of its own is left in sendMessage',
      !/const sendMessage[\s\S]*?res\.body\.getReader\(\)[\s\S]*?const sendMessageRef/.test(src));
    check('a dev build (local proxy, no attach) never asks', src.includes('const ATTACH_ENABLED = !import.meta.env.DEV;'));
    check('the restore attaches when needsAttach says so',
      /needsAttach\(list\.find\(s => s\.id === sid\), readSavedMsgs\(sid\)\)/.test(src)
      && src.includes('attachIntoTabRef.current(tabId, sid)'));
    check('restart drops the half-built bubble', src.includes('dropPartialTail(t.messages)'));
    check('the save effect keeps the unfinished-tail mark', src.includes('...(m.partial || m._streaming ? { partial: true } : {})'));
    check('a lost turn marks its bubble and error line partial',
      /m\._streaming \? \{ role: m\.role, content: m\.content, partial: true \}/.test(src)
      && src.includes('{ role: "assistant", content: errContent, partial: true }'));
    check('a 409 on reload is silent', src.includes('!(e.name === "AttachRefused" && e.status === 409)'));
    check('the tab strip labels through tabLabel', src.includes('{tabLabel(tab, tabs)}'));
  }

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
