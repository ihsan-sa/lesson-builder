// The longest tutor system prompt (chars) the proxy still passes on argv.
//
// server/proxy.js withSystemPrompt and the hosted tutor's chat.py MAX_SYSTEM hold the same
// literal; above it the prompt is demoted into stdin and loses priority. This is the one
// copy the checks read: lesson-template/test_lesson.cjs (T18, every lesson's gate),
// tests/tutor-policy/check.cjs and sweep.mjs. Change it here when the proxy's changes.
export const SYSTEM_ARGV_CEILING = 28000;
