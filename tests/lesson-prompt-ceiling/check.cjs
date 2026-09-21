#!/usr/bin/env node
/**
 * A lesson's own gate fails when its tutor prompt is over the argv ceiling.
 *
 * The proxy passes the system prompt on argv only while it is <= 28000 chars; above that it is
 * demoted into stdin and loses priority, and nothing in a lesson failed: `test_lesson.cjs`
 * passed, `vite build` passed, the lesson served (raised from the lessons repo, 2026-09-16,
 * where a course session paid two rewrite cycles finding the real headroom by hand).
 * `lesson-template/test_lesson.cjs` T18 now assembles `buildSystemPrompt` over the lesson's
 * LESSON_CONTEXT, in both memory modes, and fails on the larger.
 *
 * Each case scaffolds a workspace of its own (the real `_lesson-core` chat/ and constants/,
 * the real `test_lesson.cjs`, a fixture lesson) and runs the gate in it. What each asserts is
 * in README.md. Node and one `npm install --prefer-offline` of @babel/parser (served from the
 * npm cache when there is one); no network otherwise, no browser.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const BOOT = path.join(SKILL, 'references', 'bootstrap');
const CORE = path.join(BOOT, '_lesson-core');
const TEMPLATE = path.join(BOOT, 'lesson-template');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-prompt-ceiling-'));
process.on('exit', () => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

// ---------- the template's own dependency, installed once and shared ----------
const templatePkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'package.json'), 'utf8'));
const PARSER_SPEC = `@babel/parser@${templatePkg.devDependencies['@babel/parser']}`;
const depRoot = path.join(tmpRoot, '_deps');
fs.mkdirSync(depRoot, { recursive: true });
fs.writeFileSync(path.join(depRoot, 'package.json'), '{"name":"lesson-prompt-ceiling-deps","private":true}\n');
{
  const r = spawnSync('npm', ['install', '--no-save', '--silent', '--prefer-offline', PARSER_SPEC],
    { cwd: depRoot, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`could not install ${PARSER_SPEC}:\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
}

const COURSE_NAME = 'Fixture Course Name';
const INSTITUTION = 'Fixture University';

/**
 * A workspace of this case's own and one lesson in it. `context` is the LESSON_CONTEXT text
 * (a plain string, written into a template literal); `withCore: false` leaves the core out.
 */
function workspace(name, { context, withCore = true, withContext = true }) {
  const ws = path.join(tmpRoot, name);
  const root = path.join(ws, 'PHYS201', 'claude_lessons', 'sample-lesson');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  if (withCore) {
    for (const sub of ['chat/buildSystemPrompt.js', 'constants/promptBudget.js']) {
      fs.mkdirSync(path.dirname(path.join(ws, '_lesson-core', sub)), { recursive: true });
      fs.copyFileSync(path.join(CORE, sub), path.join(ws, '_lesson-core', sub));
    }
  }
  fs.copyFileSync(path.join(TEMPLATE, 'test_lesson.cjs'), path.join(root, 'test_lesson.cjs'));
  fs.symlinkSync(path.join(depRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(root, 'src', 'sample_lesson.jsx'), [
    'import { Chatbot } from "@core";',
    withContext ? `const LESSON_CONTEXT = \`${context}\`;` : '',
    'export default function LessonApp() {',
    '  return <Chatbot courseCode="PHYS 201" courseName="' + COURSE_NAME + '" institution="' + INSTITUTION + '"',
    '    lessonContext={LESSON_CONTEXT} lessonFile="src/sample_lesson.jsx" />;',
    '}',
    '',
  ].join('\n'));
  return root;
}

/** Run the lesson's gate; only T18's own lines are read, the other tests are not this case's. */
function gate(root) {
  const r = spawnSync(process.execPath, ['test_lesson.cjs', 'src/sample_lesson.jsx'], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const lines = out.split('\n');
  const i = lines.findIndex((l) => /^\s+(PASS|FAIL): T18/.test(l));
  // T18 prints its detail lines before its PASS/FAIL line, after T17's.
  let start = i;
  while (start > 0 && !/^\s+(PASS|FAIL): T17/.test(lines[start - 1])) start--;
  return { code: r.status, out, t18: i < 0 ? '' : lines.slice(start, i + 1).join('\n'), verdict: i < 0 ? null : lines[i].trim().split(':')[0] };
}

(async () => {
  const { buildSystemPrompt } = await import(pathToFileURL(path.join(CORE, 'chat', 'buildSystemPrompt.js')).href);
  const { SYSTEM_ARGV_CEILING: CEILING } = await import(pathToFileURL(path.join(CORE, 'constants', 'promptBudget.js')).href);
  const props = { courseCode: 'PHYS 201', courseName: COURSE_NAME, institution: INSTITUTION, lessonFile: 'src/sample_lesson.jsx' };
  const size = (ctx, isolatedFlag) => buildSystemPrompt({ ...props, lessonContext: ctx, isolatedFlag }).length;
  // A context (no Read/Glob/Grep word, no policy text) that makes the ISOLATION prompt
  // exactly `target` chars; the prompt grows one char per context char.
  const contextFor = (target) => {
    const n = target - size('', true);
    let s = '';
    while (s.length < n) s += 'coupled lines and even modes. ';
    return s.slice(0, n);
  };

  heading('1', 'a lesson well under the ceiling passes and prints its headroom');
  {
    const ctx = 'PHYS 201 unit 2: kinematics of a helix.';
    const g = gate(workspace('small', { context: ctx }));
    check('T18 passes', g.verdict === 'PASS', g.out);
    const iso = size(ctx, true), mem = size(ctx, false);
    check('the mode with the larger prompt is the one measured', iso >= mem && /isolation mode/.test(g.t18), g.t18);
    check(`prints the size (${iso}), the ceiling (${CEILING}) and the headroom (${CEILING - iso})`,
      g.t18.includes(`${iso} chars`) && g.t18.includes(`ceiling ${CEILING}`) && g.t18.includes(`headroom ${CEILING - iso}`), g.t18);
  }

  heading('2', 'an oversized LESSON_CONTEXT fails T18 and the whole gate, naming size, ceiling and overflow');
  {
    const ctx = contextFor(CEILING + 1500);
    const g = gate(workspace('oversized', { context: ctx }));
    check('T18 fails', g.verdict === 'FAIL', g.t18 || g.out);
    check('the gate exits non-zero', g.code === 1, `exit ${g.code}`);
    check(`names the measured size (${CEILING + 1500})`, g.t18.includes(`${CEILING + 1500} chars`), g.t18);
    check(`names the ceiling (${CEILING})`, g.t18.includes(`ceiling ${CEILING}`), g.t18);
    check('names the overflow (1500)', /over by 1500\b/.test(g.t18), g.t18);
    check('says what to do: shorten LESSON_CONTEXT by at least the overflow', /shorten LESSON_CONTEXT by at least 1500/.test(g.t18), g.t18);
  }

  heading('3', 'the ceiling itself is the edge: exactly 28000 passes with no headroom, one over fails');
  {
    const atCeiling = gate(workspace('at-ceiling', { context: contextFor(CEILING) }));
    check(`${CEILING} chars passes`, atCeiling.verdict === 'PASS', atCeiling.t18);
    check('…and prints headroom 0', /headroom 0\b/.test(atCeiling.t18), atCeiling.t18);
    const over = gate(workspace('one-over', { context: contextFor(CEILING + 1) }));
    check(`${CEILING + 1} chars fails`, over.verdict === 'FAIL', over.t18);
    check('…by 1', /over by 1\b/.test(over.t18), over.t18);
  }

  heading('4', 'a lesson with no LESSON_CONTEXT, or no core beside it, fails T18 instead of passing unmeasured');
  {
    const none = gate(workspace('no-context', { withContext: false }));
    check('no LESSON_CONTEXT: T18 fails', none.verdict === 'FAIL' && /LESSON_CONTEXT/.test(none.t18), none.t18);
    const noCore = gate(workspace('no-core', { context: 'PHYS 201.', withCore: false }));
    check('no _lesson-core: T18 fails and names the missing file',
      noCore.verdict === 'FAIL' && /buildSystemPrompt\.js not found/.test(noCore.t18), noCore.t18);
  }

  heading('5', 'one source for the number: the checks read the constant, and it matches the proxy');
  {
    const read = (...p) => fs.readFileSync(path.join(SKILL, ...p), 'utf8');
    for (const f of [['references', 'bootstrap', 'lesson-template', 'test_lesson.cjs'], ['tests', 'tutor-policy', 'check.cjs'], ['tests', 'tutor-policy', 'sweep.mjs']]) {
      check(`${f.slice(-2).join('/')} carries no 28000 literal of its own`,
        !/(?<![\w.])28000(?![\w.])/.test(read(...f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')));
    }
    check(`server/proxy.js's argv threshold is the constant (${CEILING})`,
      read('references', 'bootstrap', '_lesson-core', 'server', 'proxy.js').includes(`system.length <= ${CEILING}`));
  }

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
