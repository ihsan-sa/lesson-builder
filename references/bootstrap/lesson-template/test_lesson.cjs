const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.log('Usage: node test_lesson.cjs <file.jsx>'); process.exit(1); }

const code = fs.readFileSync(file, 'utf8');
let passed = 0, failed = 0, total = 0;

function test(name, fn) {
  total++;
  try {
    const result = fn();
    if (result) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.log(`  FAIL: ${name}`); }
  } catch(e) { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

console.log(`\nTesting: ${path.basename(file)}\n${'='.repeat(50)}`);

// T1: JSX Parse
test('T1 — JSX Babel parse', () => {
  const parser = require('@babel/parser');
  parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  return true;
});

// T2: KaTeX safety -- no bare < in string expressions
test('T2 — No bare < in KaTeX strings', () => {
  const lines = code.split('\n');
  const bad = [];
  const re = /\{"[^"]*<[^"]*"\}/g;
  const safe = /\\\\lt|\\\\leq|\\\\left|\\\\ll|\\\\lambda|\\\\langle|\\\\ldots/;
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].match(re);
    if (matches) {
      for (const m of matches) {
        if (!safe.test(m)) bad.push({ line: i+1, match: m });
      }
    }
  }
  if (bad.length > 0) {
    bad.forEach(b => console.log(`    Line ${b.line}: ${b.match}`));
    return false;
  }
  return true;
});

// T3: No bare < > in JSX text (h2, h3, h4 tags)
test('T3 — No bare angle brackets in heading text', () => {
  const re = /<h[234]>[^<]*[<>][^<]*<\/h[234]>/g;
  const matches = code.match(re);
  if (matches && matches.length > 0) {
    matches.forEach(m => console.log(`    ${m}`));
    return false;
  }
  return true;
});

// T4: Has export default
test('T4 — Has export default', () => {
  return /export\s+default/.test(code);
});

// T5: TOPICS array exists and is non-empty
test('T5 — TOPICS array defined', () => {
  return /const\s+TOPICS\s*=\s*\[/.test(code);
});

// T6: TOPIC_CONTEXT object exists
test('T6 — TOPIC_CONTEXT defined', () => {
  return /const\s+TOPIC_CONTEXT\s*=\s*\{/.test(code);
});

// T7: LESSON_CONTEXT exists
test('T7 — LESSON_CONTEXT defined', () => {
  return /const\s+LESSON_CONTEXT\s*=/.test(code);
});

// T8: Imports Chatbot + UI primitives from @core (replaces bespoke MODELS check)
test('T8 — Imports from @core (Chatbot, UI primitives)', () => {
  return /from\s+["']@core["']/.test(code) && /Chatbot/.test(code);
});

// T9: Uses gold accent color (via Chatbot className, not raw hex)
test('T9 — Uses lesson chrome classes (gold accent via @core CSS)', () => {
  // After refactor, #c8a45a lives in _lesson-core/chat/chat.css.js, not the lesson file.
  // Lesson still applies className="theme-dark|theme-light" which maps --accent.
  return /className=\{?\s*["`]theme-/.test(code);
});

// T10: IBM Plex fonts referenced (now via CSS from @core, but check lesson uses monospace UI)
test('T10 — Uses IBM Plex Mono for lesson UI', () => {
  // The lesson's inline styles still reference 'IBM Plex Mono' for monospace labels.
  return code.includes('IBM Plex');
});

// T11: Lesson uses shared CSS classes (will be styled by @core STYLES)
test('T11 — Uses core CSS classes (eq-block, key-concept, chat-panel)', () => {
  // .eq-block is applied by the <Eq> component (from @core), .key-concept by <KeyConcept>,
  // .chat-panel by <Chatbot>. Check the lesson imports those pieces.
  return /Eq\s*,/.test(code) && /KeyConcept/.test(code) && /Chatbot/.test(code);
});

// T12: No direct localStorage (sessionStorage alias _ss is intentional)
test('T12 — No browser storage APIs', () => {
  return !code.includes('localStorage');
});

// T13: No emojis
test('T13 — No emojis', () => {
  const emojiRe = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  return !emojiRe.test(code);
});

// T14: TOPIC_CONTEXT keys match TOPICS ids
//
// Parses the file with Babel (already a dep for T1) and walks the AST to find
// the `TOPICS` array and `TOPIC_CONTEXT` object declarations. This avoids
// earlier regex pitfalls: (1) a bare `id:\s*"..."` regex matched `id` fields
// in unrelated graph component data structures, producing false positives,
// and (2) the ctx-key regex only matched values starting with a backtick, so
// TOPIC_CONTEXT entries that used plain strings were silently ignored and the
// test reported the wrong missing key.
test('T14 — TOPIC_CONTEXT keys match TOPICS ids', () => {
  const parser = require('@babel/parser');
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  let topicsNode = null;
  let ctxNode = null;
  for (const node of ast.program.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const decl of node.declarations) {
      if (decl.id && decl.id.type === 'Identifier' && decl.init) {
        if (decl.id.name === 'TOPICS' && decl.init.type === 'ArrayExpression') {
          topicsNode = decl.init;
        } else if (decl.id.name === 'TOPIC_CONTEXT' && decl.init.type === 'ObjectExpression') {
          ctxNode = decl.init;
        }
      }
    }
  }
  if (!topicsNode || !ctxNode) {
    console.log('    Could not locate TOPICS array or TOPIC_CONTEXT object');
    return false;
  }
  // Extract topic ids from TOPICS array: each element is an object literal
  // with an `id: "..."` property.
  const topicIds = [];
  for (const el of topicsNode.elements) {
    if (!el || el.type !== 'ObjectExpression') continue;
    for (const prop of el.properties) {
      if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
      const keyName = prop.key.type === 'Identifier' ? prop.key.name
                    : prop.key.type === 'StringLiteral' ? prop.key.value
                    : null;
      if (keyName === 'id' && prop.value.type === 'StringLiteral') {
        topicIds.push(prop.value.value);
      }
    }
  }
  // Extract keys from TOPIC_CONTEXT object. Accepts both identifier and
  // string-literal keys so authors can use either quoting style.
  const ctxKeys = [];
  for (const prop of ctxNode.properties) {
    if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
    if (prop.key.type === 'Identifier') ctxKeys.push(prop.key.name);
    else if (prop.key.type === 'StringLiteral') ctxKeys.push(prop.key.value);
  }
  if (topicIds.length === 0) return false;
  for (const id of topicIds) {
    if (!ctxKeys.includes(id)) {
      console.log(`    Missing TOPIC_CONTEXT for id: "${id}"`);
      return false;
    }
  }
  return true;
});

// T15: Imports useKatex hook from @core (replaces bespoke EFFORT_LEVELS check)
test('T15 — Imports useKatex hook from @core', () => {
  return /useKatex/.test(code);
});

// T16: LessonApp renders <Chatbot> with courseCode prop (replaces bespoke makeTab check)
test('T16 — Renders <Chatbot> with courseCode prop', () => {
  return /<Chatbot\b/.test(code) && /courseCode=/.test(code);
});

// T17: Uses @core Chatbot (routes chat through local proxy, not direct API)
test('T17 — Uses @core Chatbot (no direct api.anthropic.com)', () => {
  const importsChatbot = /import\s*\{[^}]*Chatbot[^}]*\}\s*from\s*["']@core["']/.test(code);
  const usesDirectApi = code.includes('api.anthropic.com');
  if (usesDirectApi) console.log('    Found direct api.anthropic.com URL');
  return importsChatbot && !usesDirectApi;
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
