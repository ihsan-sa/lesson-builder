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
const CHATBOT_JSX = path.join(CHAT, 'Chatbot.jsx');
const THREAD_PANEL_JSX = path.join(CHAT, 'ThreadPanel.jsx');

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

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
