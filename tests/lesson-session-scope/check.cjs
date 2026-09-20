#!/usr/bin/env node
/**
 * One lesson's tutor chat never reappears on another lesson.
 *
 * sessionStorage is per ORIGIN and survives same-tab navigation, so the bare `kcSessions` key
 * the chat used to keep made an ECE206 lesson auto-restore a chat born on an ECE260 lesson,
 * which then answered with ECE260's facts (owner, 2026-09-20, #lessons 1789942972.715899).
 * The server half (lessons/chat.py) records the lesson a session was born on, filters /sessions
 * by it and refuses session/open for another lesson's; this half is
 * `references/bootstrap/_lesson-core/chat/lessonSessions.js` plus its wiring in Chatbot.jsx:
 * every key is scoped by the lesson's BASE_URL, the picker names each chat's lesson and never
 * offers another lesson's, and a refused cross-lesson open starts a fresh session silently.
 *
 * Node only. No npm install, no network, no browser. Cases 1-5 drive lessonSessions.js against
 * a Map standing in for sessionStorage; case 6 reads Chatbot.jsx as text, because what that file
 * must NOT do (read the old un-namespaced keys) has no function to call.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const CHAT = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'chat');
const SESSIONS_JS = path.join(CHAT, 'lessonSessions.js');
const CHATBOT_JSX = path.join(CHAT, 'Chatbot.jsx');

const A = '/ece206/ece206-course-overview/';   // the lesson the student is on
const B = '/ece260/ece260-ac-circuits/';       // the lesson the stale chat was born on

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

// A sessionStorage of its own per case: no case may lean on what an earlier one left.
function storage(entries) {
  const m = new Map(Object.entries(entries || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    keys: () => [...m.keys()],
    raw: m,
  };
}
const kept = (ss, base, mod) => mod.readKept(ss, base).map(s => s.sessionId);

(async () => {
  const S = await import(pathToFileURL(SESSIONS_JS).href);

  heading('1', 'every key carries the lesson, so one lesson cannot read the other\'s');
  {
    const ss = storage();
    S.keepSession(ss, A, 'sid-a', 1);
    S.keepSession(ss, B, 'sid-b', 1);
    check('the lesson the student is on sees only its own chat', JSON.stringify(kept(ss, A, S)) === '["sid-a"]',
      `got ${JSON.stringify(kept(ss, A, S))}`);
    check('…and the other lesson only its own', JSON.stringify(kept(ss, B, S)) === '["sid-b"]',
      `got ${JSON.stringify(kept(ss, B, S))}`);
    ss.setItem(S.msgsKey(A, 'sid'), 'a-transcript');
    ss.setItem(S.msgsKey(B, 'sid'), 'b-transcript');
    check('a transcript for the same session id does not cross either',
      ss.getItem(S.msgsKey(A, 'sid')) === 'a-transcript' && ss.getItem(S.msgsKey(B, 'sid')) === 'b-transcript');
    check('the reinforcement list is scoped too', S.reinfKey(A, 'sid') !== S.reinfKey(B, 'sid'));
    const bare = ['kcSessions', 'chatMsgs_sid', 'chatReinf_sid'];
    check('no key equals the old un-namespaced one', !ss.keys().some(k => bare.includes(k)),
      `keys: ${ss.keys().join(', ')}`);
  }

  heading('2', 'a stale un-namespaced kcSessions from before this change is ignored, not migrated');
  {
    const ss = storage({
      kcSessions: JSON.stringify([{ sessionId: 'sid-old', chatNum: 7 }]),
      'chatMsgs_sid-old': JSON.stringify([{ role: 'user', content: 'ECE260 talk' }]),
    });
    check('the old list is not read back', kept(ss, A, S).length === 0,
      `got ${JSON.stringify(kept(ss, A, S))}`);
    check('the old transcript is not read back', ss.getItem(S.msgsKey(A, 'sid-old')) === null);
    S.keepSession(ss, A, 'sid-new', 1);
    check('the new chat is kept under the scoped key', JSON.stringify(kept(ss, A, S)) === '["sid-new"]');
    check('…and the old key is left where it was, not rewritten',
      ss.getItem('kcSessions') === JSON.stringify([{ sessionId: 'sid-old', chatNum: 7 }]));
  }

  heading('3', 'restore takes this lesson\'s kept chat and never another lesson\'s');
  {
    const ss = storage();
    S.keepSession(ss, A, 'sid-a', 3);
    const list = [{ id: 'sid-a', chatNum: 3, base: A }];
    const asked = [];
    const r = await S.restoreKept({
      ss, base: A, list, isRestorable: () => true, firstTabId: 1,
      openTab: () => { throw new Error('a second tab for one kept session'); },
      closeTab: () => {}, resume: (tabId, sid) => { asked.push([tabId, sid]); return true; },
    });
    check('the lesson\'s own chat is resumed into the first tab', r.restored === true && !r.refused
      && JSON.stringify(asked) === JSON.stringify([[1, 'sid-a']]), `asked ${JSON.stringify(asked)}, ${JSON.stringify(r)}`);
    check('…and stays kept for the next load', JSON.stringify(kept(ss, A, S)) === '["sid-a"]');

    const ss2 = storage();
    S.keepSession(ss2, A, 'sid-b', 9);   // a stale entry naming a chat born on B
    const asked2 = [];
    const r2 = await S.restoreKept({
      ss: ss2, base: A, list: [{ id: 'sid-b', chatNum: 9, base: B }], isRestorable: () => true,
      firstTabId: 1, openTab: () => 2, closeTab: () => {},
      resume: (tabId, sid) => { asked2.push(sid); return true; },
    });
    check('a session the server says was born on another lesson is never opened',
      asked2.length === 0 && r2.restored === false, `asked ${JSON.stringify(asked2)}`);

    // A server that has not landed its half yet records no lesson on a session. The kept key
    // is already scoped, so that id IS this lesson's -- a reload must still keep its chat.
    const ss3 = storage();
    S.keepSession(ss3, A, 'sid-nobase', 5);
    const asked3 = [];
    const r3 = await S.restoreKept({
      ss: ss3, base: A, list: [{ id: 'sid-nobase', chatNum: 5 }], isRestorable: () => true,
      firstTabId: 1, openTab: () => 2, closeTab: () => {},
      resume: (tabId, sid) => { asked3.push(sid); return true; },
    });
    check('a session with no lesson recorded still restores from this lesson\'s own kept list',
      r3.restored === true && JSON.stringify(asked3) === JSON.stringify(['sid-nobase']),
      `asked ${JSON.stringify(asked3)}`);
  }

  heading('4', 'a refused open starts fresh silently, and the refused chat is forgotten');
  {
    const ss = storage();
    S.keepSession(ss, A, 'sid-gone', 4);
    const r = await S.restoreKept({
      ss, base: A, list: [{ id: 'sid-gone', chatNum: 4 }], isRestorable: () => true, firstTabId: 1,
      openTab: () => { throw new Error('a second tab for one kept session'); },
      closeTab: () => {}, resume: () => false,          // the server refused
    });
    check('the caller is told to start fresh, not to show the picker',
      r.restored === false && r.refused === true, JSON.stringify(r));
    check('the refused session is dropped, so the next load does not ask again', kept(ss, A, S).length === 0,
      `still kept: ${JSON.stringify(kept(ss, A, S))}`);

    // Two kept chats: the first opens, the second is refused -- the tab opened for it goes away.
    const ss2 = storage();
    S.keepSession(ss2, A, 'sid-1', 1);
    S.keepSession(ss2, A, 'sid-2', 2);
    const closed = [];
    let next = 9;
    const r2 = await S.restoreKept({
      ss: ss2, base: A, list: [{ id: 'sid-1', chatNum: 1 }, { id: 'sid-2', chatNum: 2 }],
      isRestorable: () => true, firstTabId: 1, openTab: () => ++next, closeTab: (t) => closed.push(t),
      resume: (tabId, sid) => sid === 'sid-1',
    });
    check('the first chat is restored even though the second was refused',
      r2.restored === true && r2.refused === true, JSON.stringify(r2));
    check('the extra tab opened for the refused chat is taken away', JSON.stringify(closed) === '[10]',
      `closed ${JSON.stringify(closed)}`);
    check('only the refused one is forgotten', JSON.stringify(kept(ss2, A, S)) === '["sid-1"]',
      `kept ${JSON.stringify(kept(ss2, A, S))}`);
  }

  heading('5', 'the picker names each chat\'s lesson');
  {
    const s = { id: 'sid-a', chatNum: 3, messageCount: 12, isolated: true, base: A };
    const label = S.sessionLabel(s, A);
    check('the label leads with the lesson', label.startsWith('ece206/ece206-course-overview'), label);
    check('…and keeps what the old label said', label.includes('Chat #3 (12 msgs) ISO'), label);
    // A dev build's base is "/" and names no lesson: the label is then the old one, which is
    // what tests/resume-metadata clicks (`^Chat #<n> `).
    const dev = S.sessionLabel({ chatNum: 2, messageCount: 4, isolated: false }, '/');
    check('under vite dev the label is unprefixed', dev === 'Chat #2 (4 msgs) MEM', dev);
    check('a chat born on another lesson is never offered', S.ownsSession({ base: B }, A) === false);
    check('…and one that says it is this lesson\'s is', S.ownsSession({ base: A }, A) === true);
    // The server treats a session with no lesson recorded as another lesson's; so does the
    // picker, which has nothing to label it with. Only the kept list may still restore it.
    check('a chat with no lesson recorded is not offered either', S.ownsSession({ chatNum: 1 }, A) === false);
    check('…except under vite dev, whose own proxy serves one lesson',
      S.ownsSession({ chatNum: 1 }, '/') === true);
    check('…but it is not KNOWN to be another lesson\'s, so restore may have it',
      S.foreignSession({ chatNum: 1 }, A) === false && S.foreignSession({ base: B }, A) === true);
  }

  heading('6', 'Chatbot.jsx reads no un-namespaced key, and wires the silent restore');
  {
    const src = fs.readFileSync(CHATBOT_JSX, 'utf8');
    check('nothing reads or writes the old kcSessions key', !src.includes('"kcSessions"'),
      'a stale cross-lesson list would come straight back');
    check('no bare chatMsgs_/chatReinf_ key either',
      !src.includes('"chatMsgs_"') && !src.includes('"chatReinf_"'));
    check('the keys come from lessonSessions.js', src.includes('from "./lessonSessions.js"'));
    check('scoped by this bundle\'s own lesson', src.includes('const LESSON_BASE = import.meta.env.BASE_URL;'));
    check('the auto-restore resumes silently', src.includes('resumeSessionIntoTab(tabId, sid, num, true)'));
    check('a refusal starts a fresh session instead of the picker',
      /if \(refused\) \{ await createSessionForTab\(firstTab\.id\); return; \}/.test(src));
    check('the picker labels entries with their lesson', src.includes('sessionLabel(s, LESSON_BASE)'));
    check('the picker offers only sessions that say they are this lesson\'s',
      /serverSessions\.filter\(s => isPickable\(s\) && ownsSession\(s, LESSON_BASE\)/.test(src));
    check('…and the picker only opens at all for those',
      src.includes('list.filter(s => isPickable(s) && ownsSession(s, LESSON_BASE))'));
  }

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
