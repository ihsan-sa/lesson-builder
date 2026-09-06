#!/usr/bin/env node
/**
 * Fixture for `scripts/lesson-ast.cjs` — the inventory, the splice and the unused-code report,
 * all taken from a Babel parse of the lesson.
 *
 *   ./check.cjs            # exit 0 only when every case passes
 *   KEEP=1 ./check.cjs     # keep the temp lesson roots and print their paths
 *
 * Node plus one dependency: `@babel/parser`, at the version the lesson template already pins, and
 * installed the way a lesson installs it. Nothing else — no browser, no network beyond that
 * install (which is served from the npm cache when there is one), no manim.
 *
 * Every case copies `lesson/` into a lesson root of its own, so no case reads state another left
 * behind, and each asserts both what is reported and what is deliberately not: the capitalised
 * helper is not a graph, the paired manim source is not an orphan, the two-user helper is not
 * stranded by losing one user.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(SKILL, 'scripts', 'lesson-ast.cjs');
const FIXTURE = path.join(__dirname, 'lesson');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-inventory-'));

let failures = 0;
let checks = 0;

function ok(cond, what) {
  checks++;
  if (cond) return true;
  failures++;
  process.stdout.write(`  FAIL ${what}\n`);
  return false;
}

function eq(actual, expected, what) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) process.stdout.write(`  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})\n`);
  return ok(pass, what);
}

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// ---------- the template's own dependency, installed once and shared ----------

const templatePkg = JSON.parse(
  fs.readFileSync(path.join(SKILL, 'references', 'bootstrap', 'lesson-template', 'package.json'), 'utf8'),
);
const PARSER_SPEC = `@babel/parser@${templatePkg.devDependencies['@babel/parser']}`;
const depRoot = path.join(tmpRoot, '_deps');
fs.mkdirSync(depRoot, { recursive: true });
fs.writeFileSync(path.join(depRoot, 'package.json'), '{"name":"ast-inventory-deps","private":true}\n');
{
  const r = spawnSync('npm', ['install', '--no-save', '--silent', '--prefer-offline', PARSER_SPEC],
    { cwd: depRoot, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`could not install ${PARSER_SPEC}:\n${r.stderr || r.stdout}\n`);
    process.exit(1);
  }
}
const DEP_MODULES = path.join(depRoot, 'node_modules');

/** A lesson root of this case's own: the fixture lesson, and the parser where a lesson keeps it. */
function lesson(name) {
  const root = path.join(tmpRoot, name, 'PHYS201', 'claude_lessons', 'sample-lesson');
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.cpSync(FIXTURE, root, { recursive: true });
  fs.symlinkSync(DEP_MODULES, path.join(root, 'node_modules'), 'dir');
  return { root, file: path.join(root, 'src', 'sample_lesson.jsx') };
}

const inventory = (root) => JSON.parse(run(['inventory', '--lesson', root]).out);
// Top-level bindings in lesson/src/sample_lesson.jsx: 16 imported, 8 consts, 7 functions. The
// receipts count the ones a splice left alone, so this is what they are checked against.
const TOP_LEVEL_DECLARATIONS = 31;
const byName = (rows, name) => rows.find((r) => r.name === name);

// ---------- 1. the inventory ----------

function caseInventory() {
  process.stdout.write('1  inventory of a lesson with every medium in it\n');
  const { root, file } = lesson('inventory');
  const inv = inventory(root);

  eq(inv.graph_components.map((g) => g.name), ['WaveGraph', 'SpectrumGraph'], 'both graphs found');
  eq(inv.graph_components.map((g) => g.kind), ['svg-graph', 'svg-graph'], 'graphs carry kind svg-graph');
  eq(byName(inv.graph_components, 'WaveGraph').default_params_key, 'waveGraph',
    'the graph key comes from the DEFAULT_GRAPH_PARAMS the component reads');
  eq(byName(inv.graph_components, 'WaveGraph').graph_schema_key, 'waveGraph', 'graph_schema_key set');
  eq(byName(inv.graph_components, 'WaveGraph').purpose, null, 'purpose is left for the orchestrator');
  const wave = byName(inv.graph_components, 'WaveGraph');
  const src = fs.readFileSync(file, 'utf8').split('\n');
  ok(/^function WaveGraph\(/.test(src[wave.line_range[0] - 1]), 'line_range starts at the definition');
  ok(src[wave.line_range[1] - 1] === '}', 'line_range ends at the closing brace of the definition');

  // The failure the brief names: a capitalised lesson-local function is not a graph.
  ok(!byName(inv.graph_components, 'HWQuestion'), 'the capitalised helper is NOT a graph component');
  eq(byName(inv.lesson_helpers, 'HWQuestion').kind, 'lesson-helper', 'it is a lesson-helper');
  eq(byName(inv.lesson_helpers, 'HWQuestion').used_by, ['TOPICS'], 'and TOPICS is what uses it');
  ok(!byName(inv.lesson_helpers, 'LessonApp'), 'the exported root component is not a helper');
  eq(byName(inv.lesson_helpers, 'polarPath').used_by, ['WaveGraph'], 'polarPath has one user');
  eq(byName(inv.lesson_helpers, 'axisTicks').used_by, ['WaveGraph', 'SpectrumGraph'],
    'axisTicks has two');
  eq(byName(inv.lesson_helpers, 'normalizeGain').used_by, [], 'the unused helper has no users');

  eq(inv.default_graph_params_keys, ['waveGraph', 'spectrumGraph'], 'DEFAULT_GRAPH_PARAMS keys');
  eq(inv.graph_schema_keys, ['waveGraph', 'spectrumGraph'], 'GRAPH_SCHEMA keys');
  eq(inv.graph_schema_backfill_needed, false, 'no backfill needed: the schema is exported');

  eq(inv.ref_img_constants.map((c) => [c.name, c.kind]), [['IMG_SPECTRUM_REFERENCE', 'matplotlib-ref']],
    'the base64 constant is found by name and kind');
  ok(!JSON.stringify(inv).includes('iVBORw0KGgo'), 'and its blob is never in the inventory');
  ok(!inv.ref_img_constants.some((c) => c.name === 'IMG'), 'the IMG path prefix is not a constant row');

  eq(inv.static_images.map((i) => i.src), ['/images/spectrum-figure.png'], 'the static image');
  eq(inv.static_images[0].resolved_path, path.join(root, 'public', 'images', 'spectrum-figure.png'),
    'resolved under public/images/');
  eq(inv.videos.map((v) => v.src), ['/videos/wave-packet.mp4'], 'the video');
  eq(inv.videos[0].manim_source, path.join(root, 'wave_animation.py'), 'paired with its source');
  eq(inv.videos[0].manim_source_evidence, 'scene-class',
    'and the pairing says what proved it — the stems do not match');

  eq(inv.interactive_demos.map((d) => d.title), ['Wave Packet Explorer'], 'the demo, by title');
  ok(inv.interactive_demos[0].state_hooks.includes('sigma') &&
     inv.interactive_demos[0].state_hooks.includes('showEnvelope'),
    'its state hooks come from the useState bindings it reads');

  const orphanPaths = inv.orphans.map((o) => o.path);
  ok(orphanPaths.includes(path.join(root, 'public', 'images', 'old-diagram.png')),
    'the unreferenced image is an orphan');
  ok(orphanPaths.includes(path.join(root, 'dispersion_sweep.py')),
    'a .py no video comes from is an orphan');
  ok(!orphanPaths.includes(path.join(root, 'wave_animation.py')),
    'the paired manim source is NOT an orphan');
  ok(!orphanPaths.includes(path.join(root, 'public', 'videos', 'wave-packet.mp4')),
    'the referenced video is not an orphan');
}

// ---------- 2. a lesson that predates GRAPH_SCHEMA ----------

function caseBackfill() {
  process.stdout.write('2  a lesson with no GRAPH_SCHEMA\n');
  const { root, file } = lesson('backfill');
  const r = run(['remove', '--file', file, '--constant', 'GRAPH_SCHEMA', '--write']);
  eq(r.code, 0, 'the export can be removed to build the case');
  const inv = inventory(root);
  eq(inv.graph_schema_backfill_needed, true, 'backfill is flagged');
  eq(inv.graph_schema_keys, [], 'and there are no schema keys');
  eq(inv.graph_components.map((g) => g.graph_schema_key), [null, null],
    'so no graph claims a schema key');
  eq(inv.graph_components.map((g) => g.default_params_key), ['waveGraph', 'spectrumGraph'],
    'while the params keys are unaffected');
}

// ---------- 3. replacing a component ----------

function caseReplace() {
  process.stdout.write('3  replacing a component leaves every other byte alone\n');
  const { root, file } = lesson('replace');
  const before = fs.readFileSync(file, 'utf8');
  const range = byName(inventory(root).graph_components, 'WaveGraph').line_range;

  const replacement = [
    'function WaveGraph({ params, mid = "" }) {',
    '  const p = { ...DEFAULT_GRAPH_PARAMS.waveGraph, ...params };',
    '  const ticks = axisTicks(-6, 6, 12);',
    '  return (',
    '    <div className="eq-block">',
    '      <svg viewBox="0 0 400 240" role="img" aria-label={`wave packet ${mid}`}>',
    '        <circle cx={p.k0 * 10} cy="120" r={p.sigma * 20} />',
    '        {ticks.length > 0 && <title>{polarPath(1, p.k0)}</title>}',
    '      </svg>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');
  const withFile = path.join(root, 'replacement.jsx');
  fs.writeFileSync(withFile, `${replacement}\n`);

  const r = run(['replace', '--file', file, '--component', 'WaveGraph', '--with', withFile, '--write']);
  eq(r.code, 0, 'the replace succeeds');
  const receipt = JSON.parse(r.out);
  eq(receipt.targets.map((t) => t.target), ['component:WaveGraph'], 'the receipt names what it hit');
  eq(receipt.targets[0].line_range, range, 'and the range it replaced');
  eq(receipt.declarations.changed, [], 'no declaration it did not name changed');
  eq(receipt.declarations.removed, [], 'and none went missing');
  eq(receipt.declarations.added, [], 'and none appeared');
  eq(receipt.declarations.verified_unchanged, TOP_LEVEL_DECLARATIONS - 1,
    'every other top-level declaration was re-parsed out of the result and matched byte for byte');
  eq(receipt.bytes_on_disk, receipt.bytes_after, 'and the bytes were read back off disk');

  // The same file, rebuilt here from the line range and the replacement text. Byte for byte.
  const lines = before.split('\n');
  const expected = [
    ...lines.slice(0, range[0] - 1),
    ...replacement.split('\n'),
    ...lines.slice(range[1]),
  ].join('\n');
  const after = fs.readFileSync(file, 'utf8');
  eq(after, expected, 'the file is exactly the old file with that one range swapped');
  eq(after.length, Buffer.byteLength(after), 'no encoding surprise in the comparison');

  // Every line outside the replaced range is the line that was there, in the order it was in.
  const untouchedBefore = [...lines.slice(0, range[0] - 1), ...lines.slice(range[1])];
  const afterLines = after.split('\n');
  const untouchedAfter = [
    ...afterLines.slice(0, range[0] - 1),
    ...afterLines.slice(range[0] - 1 + replacement.split('\n').length),
  ];
  eq(untouchedAfter, untouchedBefore, 'every other line is unchanged and in the same order');

  eq(run(['reachability', '--file', file]).code, 0, 'and the file still parses');
  ok(!fs.existsSync(`${file}.lesson-ast.part`), 'no .part file is left behind');
}

// ---------- 3b. replacing an interactive demo by its title ----------

function caseReplaceDemo() {
  process.stdout.write('3b replacing an interactive demo, matched by the title a person set\n');
  const { root, file } = lesson('replace-demo');
  const before = fs.readFileSync(file, 'utf8');
  const range = inventory(root).interactive_demos[0].line_range;

  const block = [
    '<InteractiveDemo title="Wave Packet Explorer">',
    '      <Slider label="Envelope width" value={sigma} min={0.2} max={6} step={0.05} onChange={setSigma} />',
    '      <WaveGraph params={{ ...graphParams.waveGraph, sigma, showEnvelope }} mid="demo" />',
    '    </InteractiveDemo>',
  ].join('\n');
  const withFile = path.join(root, 'demo.jsx');
  fs.writeFileSync(withFile, `${block}\n`);

  const r = run(['replace', '--file', file, '--demo', 'Wave Packet Explorer',
    '--with', withFile, '--write']);
  eq(r.code, 0, 'the demo is found by its title');
  eq(JSON.parse(r.out).targets[0].target, 'demo:Wave Packet Explorer', 'the receipt names it');

  const lines = before.split('\n');
  const expected = [
    ...lines.slice(0, range[0] - 1),
    ...(lines[range[0] - 1].match(/^\s*/)[0] + block).split('\n'),
    ...lines.slice(range[1]),
  ].join('\n');
  eq(fs.readFileSync(file, 'utf8'), expected, 'and only that block changed');

  const after = inventory(root);
  eq(after.interactive_demos.map((d) => d.title), ['Wave Packet Explorer'],
    'the title a person set is still the title');
  eq(after.interactive_demos[0].state_hooks.includes('showEnvelope'), true,
    'and the state hooks are re-read from the new block');

  const missing = run(['replace', '--file', file, '--demo', 'No Such Demo', '--with', withFile]);
  eq(missing.code, 3, 'a title that is not there exits 3');
}

// ---------- 3c. a scratch file that brings more than the component ----------

function caseScratchBringsMore() {
  process.stdout.write('3c a scratch file that brings more than the component it replaces\n');

  // A helper alongside the component is legitimate — it is reported, not refused.
  {
    const { root, file } = lesson('scratch-extra');
    const withFile = path.join(root, 'extra.jsx');
    fs.writeFileSync(withFile, [
      'function waveEnvelope(x, sigma) {',
      '  return Math.exp(-((x / sigma) ** 2));',
      '}',
      '',
      'function WaveGraph({ params, mid = "" }) {',
      '  const p = { ...DEFAULT_GRAPH_PARAMS.waveGraph, ...params };',
      '  return <div className="eq-block">{waveEnvelope(p.k0, p.sigma)}{mid}</div>;',
      '}',
      '',
    ].join('\n'));

    const r = run(['replace', '--file', file, '--component', 'WaveGraph', '--with', withFile, '--write']);
    eq(r.code, 0, 'it lands');
    const decls = JSON.parse(r.out).declarations;
    eq(decls.added, ['waveEnvelope'], 'and the receipt names the declaration it brought with it');
    eq([decls.changed, decls.removed], [[], []], 'while nothing else changed or vanished');
    eq(decls.verified_unchanged, TOP_LEVEL_DECLARATIONS - 1, 'the rest verified byte for byte');
  }

  // Redeclaring a binding that is already there is not: it would quietly replace lesson code no
  // target named, which is the whole failure class the declaration check exists to catch.
  {
    const { root, file } = lesson('scratch-clobber');
    const before = fs.readFileSync(file, 'utf8');
    const withFile = path.join(root, 'clobber.jsx');
    fs.writeFileSync(withFile, [
      'function WaveGraph({ params, mid = "" }) {',
      '  return <div className="eq-block">{axisTicks(0, 1, 1)}{mid}</div>;',
      '}',
      '',
      'function axisTicks(min, max, n) {',
      '  return [min, max, n];',
      '}',
      '',
    ].join('\n'));

    const r = run(['replace', '--file', file, '--component', 'WaveGraph', '--with', withFile, '--write']);
    eq(r.code, 4, 'exit 4');
    ok(/axisTicks/.test(r.err) && /nothing written/.test(r.err),
      'naming the declaration it would have changed');
    eq(fs.readFileSync(file, 'utf8'), before, 'and the lesson is byte-identical');
    ok(!fs.existsSync(`${file}.lesson-ast.part`), 'with no .part file left behind');
  }
}

// ---------- 4. a replacement that would not parse ----------

function caseBadReplacement() {
  process.stdout.write('4  a replacement that does not parse is refused\n');
  const { root, file } = lesson('bad-replace');
  const before = fs.readFileSync(file, 'utf8');
  const withFile = path.join(root, 'broken.jsx');
  fs.writeFileSync(withFile, 'function WaveGraph({ params }) { return (<div>; }\n');

  const r = run(['replace', '--file', file, '--component', 'WaveGraph', '--with', withFile, '--write']);
  eq(r.code, 4, 'exit 4');
  ok(/does not parse/.test(r.err) && /nothing written/.test(r.err), 'and says so, and that it wrote nothing');
  eq(fs.readFileSync(file, 'utf8'), before, 'the lesson is byte-identical');
  ok(!fs.existsSync(`${file}.lesson-ast.part`), 'and no .part file is left behind');
}

// ---------- 5. removing a graph and everything that was only its ----------

function caseRemove() {
  process.stdout.write('5  removing a graph, its call site and its two keys, in one pass\n');
  const { root, file } = lesson('remove');
  const before = fs.readFileSync(file, 'utf8');

  const r = run(['remove', '--file', file,
    '--component', 'SpectrumGraph', '--call-site', 'SpectrumGraph',
    '--params-key', 'spectrumGraph', '--schema-key', 'spectrumGraph', '--write']);
  eq(r.code, 0, 'the remove succeeds');
  const decls = JSON.parse(r.out).declarations;
  eq([decls.changed, decls.removed, decls.added], [[], [], []],
    'no declaration outside the four it named changed, vanished or appeared');
  // The four it may touch: the component, the TOPICS array holding the call site, and the two
  // objects holding the keys.
  eq(decls.verified_unchanged, TOP_LEVEL_DECLARATIONS - 4,
    'and every one of the rest was re-parsed and matched byte for byte');

  const after = fs.readFileSync(file, 'utf8');
  ok(!/SpectrumGraph|spectrumGraph/.test(after), 'no mention of the graph or its key survives');
  ok(!/\n\n\n/.test(after), 'and no run of blank lines is left where it was');

  const inv = inventory(root);
  eq(inv.graph_components.map((g) => g.name), ['WaveGraph'], 'the other graph is untouched');
  eq(inv.default_graph_params_keys, ['waveGraph'], 'the params keys agree');
  eq(inv.graph_schema_keys, ['waveGraph'], 'and so do the schema keys');
  ok(/graphKey="waveGraph"/.test(after), 'the surviving call site keeps its LiveGraph wrapper');
  ok(!/<LiveGraph[^>]*>\s*<\/LiveGraph>/.test(after), 'and no empty wrapper is left behind');

  // Every line the receipt did not name is the line that was there, in the order it was in — and
  // every line it did name is gone. Blank lines are compared by the run check just above, because
  // a removal is allowed to take one of the two blank lines it would otherwise leave touching.
  const named = new Set();
  for (const t of JSON.parse(r.out).targets)
    for (let i = t.line_range[0]; i <= t.line_range[1]; i++) named.add(i);
  const survivors = before.split('\n').filter((_, i) => !named.has(i + 1));
  const nonBlank = (lines) => lines.filter((l) => l.trim() !== '');
  eq(nonBlank(after.split('\n')), nonBlank(survivors),
    'exactly the lines the receipt named are gone, and no other line moved');
}

// ---------- 6. what a removal strands ----------

function caseReachability() {
  process.stdout.write('6  what a removal strands, and what it does not\n');
  const { file } = lesson('reachability');

  const now = JSON.parse(run(['reachability', '--file', file]).out);
  const nowNames = now.unreachable.map((u) => u.name);
  ok(nowNames.includes('normalizeGain'), 'the helper nobody calls is already unreachable');
  ok(nowNames.includes('CollapsibleBlock'), 'so is the import nobody uses');
  ok(!nowNames.includes('React'), 'but React is not: the JSX in the file compiles through it');
  ok(!nowNames.includes('polarPath') && !nowNames.includes('axisTicks'),
    'and neither helper in use is');

  // The graph is the only user of polarPath, and one of two users of axisTicks.
  const one = JSON.parse(run(['reachability', '--file', file, '--removing', 'WaveGraph']).out);
  const oneNames = one.unreachable.map((u) => u.name);
  ok(oneNames.includes('polarPath'), 'removing its only user strands polarPath');
  eq(one.unreachable.find((u) => u.name === 'polarPath').reason, 'stranded by removing WaveGraph',
    'and the report says which removal stranded it');
  ok(!oneNames.includes('axisTicks'), 'removing one of two users does not strand axisTicks');

  const two = JSON.parse(run(['reachability', '--file', file, '--removing', 'SpectrumGraph']).out);
  const twoNames = two.unreachable.map((u) => u.name);
  ok(!twoNames.includes('axisTicks'), 'and neither does removing the other one');
  ok(!twoNames.includes('polarPath'), 'nor is polarPath touched by it');

  const both = JSON.parse(
    run(['reachability', '--file', file, '--removing', 'WaveGraph,SpectrumGraph']).out);
  const bothNames = both.unreachable.map((u) => u.name);
  ok(bothNames.includes('axisTicks'), 'removing both users does strand axisTicks');
  ok(bothNames.includes('polarPath'), 'and polarPath with it');
}

// ---------- 7. a lesson that does not parse, and a target that is not there ----------

function caseRefusals() {
  process.stdout.write('7  a lesson that does not parse, and a target that is not there\n');
  const { root, file } = lesson('refusals');

  fs.writeFileSync(path.join(root, 'src', 'broken.jsx'), 'const TOPICS = [\n  { id: "topic-1" },\n');
  const broken = run(['inventory', '--lesson', root, '--file', path.join(root, 'src', 'broken.jsx')]);
  eq(broken.code, 2, 'a lesson the parser cannot read exits 2');
  ok(/broken\.jsx:\d+:\d+/.test(broken.err), 'the message carries the file, line and column');
  eq(broken.out, '', 'and nothing that looks like an inventory is printed');

  const before = fs.readFileSync(file, 'utf8');
  const missing = run(['remove', '--file', file, '--component', 'NoSuchGraph', '--write']);
  eq(missing.code, 3, 'a target that matches nothing exits 3');
  eq(fs.readFileSync(file, 'utf8'), before, 'and the lesson is untouched');

  const noKey = run(['remove', '--file', file, '--params-key', 'noSuchKey', '--write']);
  eq(noKey.code, 3, 'so does a DEFAULT_GRAPH_PARAMS key that is not there');
  eq(fs.readFileSync(file, 'utf8'), before, 'still untouched');

  const noTarget = run(['remove', '--file', file, '--write']);
  eq(noTarget.code, 1, 'and naming no target at all is a usage error');
}

// ---------- run ----------

const started = Date.now();
for (const c of [caseInventory, caseBackfill, caseReplace, caseReplaceDemo, caseScratchBringsMore,
                 caseBadReplacement, caseRemove, caseReachability, caseRefusals]) c();

const secs = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`\n${checks - failures}/${checks} checks passed in ${secs}s\n`);
if (process.env.KEEP) process.stdout.write(`kept ${tmpRoot}\n`);
else fs.rmSync(tmpRoot, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
