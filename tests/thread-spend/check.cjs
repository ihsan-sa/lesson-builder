#!/usr/bin/env node
/**
 * A thread's running dollar total: chat.py puts "cost" (total_cost_usd) on every SSE "done"
 * event; this proves the reader captures it, `chatState.js` sums it the way chat.py's own
 * bookkeeping does (per turn, since each turn is a fresh `--resume`d CLI process and the figure
 * is that turn's own cost, not a running session total), a missing cost leaves the total
 * unchanged rather than becoming $0.00, and ThreadPanel/Chatbot are wired to it.
 *
 * Drives `references/bootstrap/_lesson-core/chat/turnStream.js` with a fake SSE stream (same
 * harness as tests/chat-reattach) for the parsing half, exercises `chatState.js`'s pure
 * `addSpend`/`fmtSpend` directly for the summing half, and reads `Chatbot.jsx` / `ThreadPanel.jsx`
 * as text for the wiring between them. Node only: no npm install, no network, no browser.
 * Exit code 0 only when every check passes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const CHAT = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'chat');
const TURN_JS = path.join(CHAT, 'turnStream.js');
const STATE_JS = path.join(CHAT, 'chatState.js');
const SESSIONS_JS = path.join(CHAT, 'lessonSessions.js');
const CHATBOT_JSX = path.join(CHAT, 'Chatbot.jsx');
const THREAD_PANEL_JSX = path.join(CHAT, 'ThreadPanel.jsx');

// A sessionStorage of its own per case, same shape tests/lesson-session-scope uses.
function storage(entries) {
  const m = new Map(Object.entries(entries || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
}

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }
function close(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

// One SSE frame as the tutor writes it (same shape tests/chat-reattach uses).
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// A Response whose body yields `chunks` then ends -- no reattach needed here, readTurn only.
function response(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return { body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }) }) } };
}

(async () => {
  const T = await import(pathToFileURL(TURN_JS).href);
  globalThis.window = {};
  const St = await import(pathToFileURL(STATE_JS).href);
  const Sess = await import(pathToFileURL(SESSIONS_JS).href);
  const chatbotSrc = fs.readFileSync(CHATBOT_JSX, 'utf8');
  const threadPanelSrc = fs.readFileSync(THREAD_PANEL_JSX, 'utf8');

  heading('1', 'turnStream.js readTurn captures the "done" event\'s cost');
  {
    const t1 = await T.readTurn(response([frame('text', { text: 'hi' }), frame('done', { text: 'hi', cost: 0.0123, usage: { input_tokens: 10 } })]));
    check('cost lands on the turn', t1.cost === 0.0123, t1.cost);
    check('the reply itself is unaffected', t1.finalText === 'hi' && t1.doneReceived);
  }

  heading('2', 'a "done" with no cost leaves it undefined -- not coerced to 0');
  {
    const t2 = await T.readTurn(response([frame('done', { text: 'ok' })]));
    check('turn.cost stays undefined (older proxy, local dev build)', t2.cost === undefined, t2.cost);
    const t3 = await T.readTurn(response([frame('done', { text: 'ok', cost: null })]));
    check('an explicit null cost is also left undefined, not coerced', t3.cost === undefined, t3.cost);
  }

  heading('3', 'chatState.js addSpend: sums per-turn costs the way chat.py\'s own book-keeping does');
  {
    let spend;
    spend = St.addSpend(spend, 0.01);
    check('first turn with a cost starts the total', close(spend, 0.01), spend);
    spend = St.addSpend(spend, 0.025);
    check('a second turn adds onto it (not replaces it)', close(spend, 0.035), spend);
    spend = St.addSpend(spend, 0.0004);
    check('a third, small turn still adds in', close(spend, 0.0354), spend);
  }

  heading('4', 'addSpend: a missing or invalid cost leaves the running total exactly as it was');
  {
    check('undefined cost, no total yet: stays undefined', St.addSpend(undefined, undefined) === undefined);
    check('undefined cost, a total already running: unchanged', St.addSpend(0.05, undefined) === 0.05);
    check('null cost: unchanged', St.addSpend(0.05, null) === 0.05);
    check('NaN cost: unchanged', St.addSpend(0.05, NaN) === 0.05);
    check('a string cost (malformed event): unchanged, not concatenated', St.addSpend(0.05, '0.02') === 0.05);
  }

  heading('5', 'fmtSpend: small and unobtrusive, nothing for a total that never started');
  {
    check('two decimals at or above a cent', St.fmtSpend(0.35) === '$0.35', St.fmtSpend(0.35));
    check('two decimals, no trailing zeros dropped', St.fmtSpend(1) === '$1.00', St.fmtSpend(1));
    check('four decimals below a cent, so it does not read as free', St.fmtSpend(0.0032) === '$0.0032', St.fmtSpend(0.0032));
    check('undefined renders nothing', St.fmtSpend(undefined) === '');
    check('a non-number renders nothing', St.fmtSpend('0.02') === '');
  }

  heading('6', 'Chatbot.jsx: the thread\'s own SSE loop captures cost and folds it into the thread record via addSpend');
  {
    check('imports addSpend from chatState.js', /import \{[^}]*addSpend[^}]*\} from "\.\/chatState\.js"/.test(chatbotSrc));
    check('the thread reader reads data.cost off its own "done" event',
      /eventType === "done"\) \{\s*finalText = data\.text \|\| finalText;\s*if \(typeof data\.cost === "number"\) turnCost = data\.cost;/.test(chatbotSrc));
    check('the finished thread record folds it in with addSpend',
      /spend: addSpend\(th\.spend, turnCost\)/.test(chatbotSrc));
    check('newly opened threads start with no spend (undefined, not 0)',
      (chatbotSrc.match(/spend: undefined/g) || []).length >= 2, 'expected both openThread and openLessonThread to seed it');
    check('the saved-transcript effect keeps every thread field (spend included) via a spread',
      /threads: m\.threads\.map\(t => \(\{ \.\.\.t, loading: false, folding: false, messages:/.test(chatbotSrc));
  }

  heading('7', 'ThreadPanel.jsx: shows the running total only once one exists, formatted, never "$0.00" for a thread with no cost yet');
  {
    check('imports fmtSpend from chatState.js', /import \{ fmtSpend \} from "\.\/chatState\.js"/.test(threadPanelSrc));
    check('renders only when thread.spend is actually a number',
      /typeof thread\.spend === "number" && \(/.test(threadPanelSrc));
    check('…through fmtSpend, in its own class', /className="thread-spend"[^>]*>\{fmtSpend\(thread\.spend\)\}/.test(threadPanelSrc));
  }

  heading('8', 'Chatbot.jsx: the MAIN conversation also totals its spend, not just side-threads (landing review, 2026-09-23)');
  {
    check('imports fmtSpend alongside addSpend from chatState.js',
      /import \{[^}]*addSpend[^}]*fmtSpend[^}]*\} from "\.\/chatState\.js"/.test(chatbotSrc)
      || /import \{[^}]*fmtSpend[^}]*addSpend[^}]*\} from "\.\/chatState\.js"/.test(chatbotSrc));
    check('applyReply (shared by a sent message and an attached turn) takes this turn\'s cost',
      /const applyReply = \(tabId, finalText, cost\) => \{/.test(chatbotSrc));
    check('…and folds it into the tab with addSpend', /const spend = addSpend\(t\.spend, cost\);/.test(chatbotSrc));
    check('a sent message reads cost off readTurnWithReattach and hands it to applyReply',
      /const \{ finalText, stopped, errored, cost \} = await readTurnWithReattach\(\{/.test(chatbotSrc)
      && /applyReply\(tabId, finalText, cost\);/.test(chatbotSrc));
    check('an attached (picked-back-up) turn does the same',
      /const \{ finalText, stopped, cost \} = await readTurnWithReattach\(\{/.test(chatbotSrc));
    check('a new tab starts with no spend (undefined, not 0)', /spend: undefined,/.test(fs.readFileSync(STATE_JS, 'utf8')));
    check('the chat header shows it only once a cost has actually arrived',
      /typeof activeTab\?\.spend === "number" && \(/.test(chatbotSrc));
    check('…through fmtSpend, in its own class', /className="chat-header-spend"[^>]*>\{fmtSpend\(activeTab\.spend\)\}/.test(chatbotSrc));
  }

  heading('9', 'the main chat\'s spend survives a reload, under its own key (landing review, 2026-09-23)');
  {
    const BASE = '/ece206/ece206-course-overview/';
    check('lessonSessions.js exports a spend key, scoped like msgsKey/reinfKey',
      typeof Sess.spendKey === 'function' && Sess.spendKey(BASE, 'sid-1') !== Sess.msgsKey(BASE, 'sid-1') && Sess.spendKey(BASE, 'sid-1') !== Sess.reinfKey(BASE, 'sid-1'));

    // The exact round trip Chatbot.jsx's save effect / resumeSessionIntoTab do:
    // write only when the tab's spend is a number, read back only when it
    // parses to a finite one.
    const save = (ss, sid, spend) => { if (typeof spend === 'number') ss.setItem(Sess.spendKey(BASE, sid), JSON.stringify(spend)); };
    const restore = (ss, sid) => {
      let out;
      const raw = ss.getItem(Sess.spendKey(BASE, sid));
      if (raw != null) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' && Number.isFinite(parsed)) out = parsed;
      }
      return out;
    };
    const ss1 = storage();
    save(ss1, 'sid-1', 0.35);
    check('a real total round-trips exactly', restore(ss1, 'sid-1') === 0.35, restore(ss1, 'sid-1'));

    const ss2 = storage();
    save(ss2, 'sid-2', undefined);
    check('no cost yet: nothing is written (no key to restore from)', restore(ss2, 'sid-2') === undefined && ss2.raw.size === 0);

    const ss3 = storage({ [Sess.spendKey(BASE, 'sid-3')]: '"not a number"' });
    check('garbage in sessionStorage is ignored on restore, not coerced', restore(ss3, 'sid-3') === undefined);

    check('Chatbot.jsx\'s save effect writes it beside reinfKey, only when tab.spend is a number',
      /_ss\.setItem\(reinfKey\(LESSON_BASE, tab\.sessionId\), JSON\.stringify\(tab\.reinforced \|\| \[\]\)\);\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(typeof tab\.spend === "number"\) _ss\.setItem\(spendKey\(LESSON_BASE, tab\.sessionId\), JSON\.stringify\(tab\.spend\)\);/.test(chatbotSrc));
    check('resumeSessionIntoTab reads it back, guarded to a finite number',
      /const rawSpend = _ss\.getItem\(spendKey\(LESSON_BASE, sid\)\);/.test(chatbotSrc)
      && /typeof parsed === "number" && Number\.isFinite\(parsed\)\) savedSpend = parsed;/.test(chatbotSrc));
    check('…and always sets spend from that restore, so a tab\'s earlier total never carries into a resumed session',
      /reinforced: savedReinf \} : \{\}\), spend: savedSpend \}\);/.test(chatbotSrc));
  }

  heading('10', 'a new session for a tab starts with no spend (landing review, 2026-09-23)');
  check('createSessionForTab clears spend along with messages',
    /sessionStatus: "ready", messages: \[\], spend: undefined \}\);/.test(chatbotSrc));

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
