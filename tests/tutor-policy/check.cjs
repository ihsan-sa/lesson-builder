#!/usr/bin/env node
/**
 * The tutor's attempt-first policy and its once-per-session study record, and the prompt
 * ceiling they must fit under.
 *
 * Study-coach milestone 3 (docs/study-coach-review-astra-2026-09-20.md § B in the lessons repo)
 * put two rules in `references/bootstrap/_lesson-core/chat/buildSystemPrompt.js`: a student who
 * asks for a solution attempts the step first, and every checked answer is labelled
 * "independent" or "with help" (the lessons repo's distill-chats reads the transcript for those
 * two words); and a study record named by a lesson's LESSON_CONTEXT is read once at the start
 * of the session, not every turn. Both ride in the system prompt, which the proxy passes on
 * argv only while it is <= 28000 chars (`server/proxy.js` withSystemPrompt, chat.py MAX_SYSTEM
 * on the hosted tutor) — so the third case assembles the prompt over a LESSON_CONTEXT as long
 * as the longest in the lessons sweep and holds the ceiling. Each case fails without the change
 * it is about: case 1 without the policy text, case 2 without the once rule, case 3 without the
 * trims that paid for them.
 *
 * Node only. No npm install, no network, no browser. What the cases assert is in README.md;
 * `sweep.mjs` re-measures LARGEST_CONTEXT_CHARS against a real lessons checkout.
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const PROMPT_JS = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'chat', 'buildSystemPrompt.js');

// The argv ceiling, verbatim from server/proxy.js and lessons/chat.py.
const CEILING = 28000;
// The longest LESSON_CONTEXT in the lessons sweep: RF/directional-couplers, 2240 chars on
// 2026-09-20 over 48 lessons (`node tests/tutor-policy/sweep.mjs` prints the current one).
// Bump it when the sweep grows, and the case says whether the prompt still fits.
const LARGEST_CONTEXT_CHARS = 2240;

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

// A context of exactly n chars with no Read/Glob/Grep word in it, so the generic
// file-access line rides too: that is the largest prompt the core builds.
function syntheticContext(n) {
  const unit = 'Unit 4, lectures 12-15: coupled lines, even and odd modes, directivity. ';
  let s = '';
  while (s.length < n) s += unit;
  return s.slice(0, n);
}

(async () => {
  const { buildSystemPrompt, PEDAGOGY_POLICY, STUDY_RECORD_RULE, FILE_ACCESS_LINE } =
    await import(pathToFileURL(PROMPT_JS).href);
  // Longer than any real lesson's, so the ceiling case measures a prompt at least as
  // long as the one a lesson assembles.
  const props = {
    courseCode: 'ECE 999',
    courseName: 'Some Long Course Name For Measuring',
    institution: 'University of Waterloo',
    lessonFile: 'src/some_lesson.jsx',
    isolatedFlag: false,
  };
  const build = (lessonContext, extra = {}) => buildSystemPrompt({ ...props, lessonContext, ...extra });

  heading('1', 'attempt first: the policy asks for the attempt, labels the answer, re-checks later');
  {
    const p = build('ECE 999 unit 1.');
    check('the policy is in the assembled prompt', p.includes(PEDAGOGY_POLICY));
    check('a request for a solution gets an attempt asked for first',
      /ask for their attempt on that step before showing anything/.test(PEDAGOGY_POLICY));
    check('the brief\'s shape is the example the tutor imitates',
      PEDAGOGY_POLICY.includes("Without opening the solution, differentiate the helix and write its speed. Show your working. I'll check that step first."));
    check('a student who cannot start is taught the one step, then asked for an independent attempt',
      /cannot start, teach that one step, then ask for an independent attempt/.test(PEDAGOGY_POLICY));
    check('the reply labels the answer with the two words distill-chats reads',
      /\*independent\* or \*with help\*/.test(PEDAGOGY_POLICY));
    check('an answer right after seeing a solution is "with help"',
      /right after seeing a solution or a worked step is with help/.test(PEDAGOGY_POLICY));
    check('a later session re-checks the same skill with a different example',
      /later session, re-check the same skill with a different example/.test(PEDAGOGY_POLICY));
    check('the old "no full solution on a first request" bullet did not survive beside it',
      !/Retrieval first\./.test(PEDAGOGY_POLICY));
  }

  heading('2', 'study record: read once per session, re-read on request; generic file line only where missing');
  {
    check('the rule reads the record once at the start of the session',
      /Read it once at the start of the session and reuse/.test(STUDY_RECORD_RULE));
    check('…and re-reads only when the student asks', /re-read only when the student asks/.test(STUDY_RECORD_RULE));
    const withRead = build('ECE 999. ECE999/STUDY.md - what he is weak on. Open with Read and a pages range.');
    const without = build('ECE 999. ECE999/STUDY.md - what he is weak on.');
    check('the rule is in the prompt whether or not the context says how to open files',
      withRead.includes(STUDY_RECORD_RULE) && without.includes(STUDY_RECORD_RULE));
    check('a context that already names the Read tool gets no generic file-access line',
      !withRead.includes(FILE_ACCESS_LINE));
    check('a context that does not gets the one generic line', without.includes(FILE_ACCESS_LINE));
    check('the generic line names the tool and the fallback',
      /Read tool/.test(FILE_ACCESS_LINE) && /Glob/.test(FILE_ACCESS_LINE));
    check('the rule is in the prompt once, not per mention',
      without.split(STUDY_RECORD_RULE).length === 2);
    const kept = build('Course notes. Read them with a pages range; Grep finds nothing in scans.');
    check('Grep/Glob alone also count as a file-access instruction', !kept.includes(FILE_ACCESS_LINE));
  }

  heading('3', `ceiling: the largest LESSON_CONTEXT in the sweep (${LARGEST_CONTEXT_CHARS} chars) assembles under ${CEILING}`);
  {
    const ctx = syntheticContext(LARGEST_CONTEXT_CHARS);
    const p = build(ctx);
    check('the generic file line is in this worst case', p.includes(FILE_ACCESS_LINE));
    check(`assembled prompt ${p.length} <= ${CEILING}`, p.length <= CEILING,
      `over by ${p.length - CEILING}: pay for new prompt text by rewriting a section, not appending`);
    const iso = build(ctx, { isolatedFlag: true });
    check(`…and in isolation mode too (${iso.length})`, iso.length <= CEILING);
    console.log(`     base (empty context) ${build('').length}, largest ${p.length}, headroom ${CEILING - p.length}`);
  }

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
