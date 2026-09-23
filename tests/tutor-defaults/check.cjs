#!/usr/bin/env node
/**
 * A new tutor chat opens on Opus 5.5 at medium effort, and the rest of the picker survives
 * the move.
 *
 * `_lesson-core/constants/models.js` is the single source of truth Chatbot.jsx seeds a new
 * chat's `model`/`effort` state from (DEFAULT_MODEL/DEFAULT_EFFORT); this checks that source
 * directly, then reads Chatbot.jsx and server/proxy.js as text for the wiring: a new chat's
 * `model`/`effort` state starts on those constants, and what a sent message posts to /chat is
 * exactly that state (so /session/init and /chat both carry claude-opus-5-5 / medium on a
 * fresh chat, without needing a browser to prove it).
 *
 * Node only. No npm install, no network, no browser. What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const CHAT = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'chat');
const CONSTANTS = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'constants');
const MODELS_JS = path.join(CONSTANTS, 'models.js');
const CHATBOT_JSX = path.join(CHAT, 'Chatbot.jsx');
const PROXY_JS = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'server', 'proxy.js');

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

(async () => {
  const M = await import(pathToFileURL(MODELS_JS).href);
  const chatbotSrc = fs.readFileSync(CHATBOT_JSX, 'utf8');
  const proxySrc = fs.readFileSync(PROXY_JS, 'utf8');

  heading('1', 'the default: Opus 5.5 at medium');
  {
    check('DEFAULT_MODEL is claude-opus-5-5', M.DEFAULT_MODEL === 'claude-opus-5-5', M.DEFAULT_MODEL);
    check('DEFAULT_EFFORT is medium', M.DEFAULT_EFFORT === 'medium', M.DEFAULT_EFFORT);
    const flagged = M.MODELS.filter(m => m.default);
    check('exactly one MODELS entry carries default:true', flagged.length === 1, JSON.stringify(flagged));
    check('…and it is the Opus 5.5 entry, labelled "Opus 5.5"',
      flagged[0]?.model === 'claude-opus-5-5' && flagged[0]?.label === 'Opus 5.5', JSON.stringify(flagged[0]));
    check('DEFAULT_MODEL is read off that flag, not array position', M.DEFAULT_MODEL === flagged[0]?.model);
  }

  heading('2', 'the rest of the picker: every earlier model is still offered, including Opus 5');
  {
    const want = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'];
    const got = M.MODELS.map(m => m.model);
    check('all six models are present (five prior + the new default)',
      want.every(w => got.includes(w)) && got.length === want.length, got.join(', '));
    const opus5 = M.MODELS.find(m => m.model === 'claude-opus-5');
    check('Opus 5 itself is no longer the default', opus5 && !opus5.default, JSON.stringify(opus5));
  }

  heading('3', 'shortcut keys: unique, non-empty, and j/g stay reserved for Chatbot\'s own gestures');
  {
    const keys = M.MODELS.map(m => m.key);
    check('every model has a key', keys.every(k => typeof k === 'string' && k.length === 1), keys.join(','));
    check('no two models share a key', new Set(keys).size === keys.length, keys.join(','));
    check('none of them is j or g', !keys.includes('j') && !keys.includes('g'), keys.join(','));
    const opus55 = M.MODELS.find(m => m.model === 'claude-opus-5-5');
    check('Opus 5.5 got a key of its own (not reusing Opus 5\'s "o")', opus55 && opus55.key && opus55.key !== 'o', JSON.stringify(opus55));
  }

  heading('4', 'effort levels: unchanged set, xhigh still offered (just not the default), proxy allowlist in sync');
  {
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('EFFORT_LEVELS still lists all five', eq(M.EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']), M.EFFORT_LEVELS.join(','));
    const safeMatch = proxySrc.match(/SAFE_EFFORTS = new Set\(\[([^\]]+)\]\)/);
    const safe = safeMatch ? JSON.parse(`[${safeMatch[1]}]`) : null;
    check('server/proxy.js SAFE_EFFORTS matches EFFORT_LEVELS', safe && eq(safe, M.EFFORT_LEVELS), JSON.stringify(safe));
  }

  heading('5', 'Chatbot.jsx: a new chat\'s model/effort state starts on the constants, and a sent message posts exactly that state');
  {
    check('imports DEFAULT_MODEL and DEFAULT_EFFORT from models.js',
      /import \{[^}]*DEFAULT_MODEL[^}]*DEFAULT_EFFORT[^}]*\} from "\.\.\/constants\/models\.js"/.test(chatbotSrc)
      || /import \{[^}]*DEFAULT_EFFORT[^}]*DEFAULT_MODEL[^}]*\} from "\.\.\/constants\/models\.js"/.test(chatbotSrc));
    check('model state is seeded from DEFAULT_MODEL', /useState\(DEFAULT_MODEL\)/.test(chatbotSrc));
    check('effort state is seeded from DEFAULT_EFFORT', /useState\(DEFAULT_EFFORT\)/.test(chatbotSrc));
    check('a sent message\'s reqBody carries that same model/effort state',
      /reqBody = \{ sessionId: tab\.sessionId, message: messageText, model: model, effort: effort \}/.test(chatbotSrc));
  }

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
