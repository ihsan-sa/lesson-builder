#!/usr/bin/env node
/**
 * Fixture for attested Phase 4 verdicts (`scripts/run-manifest.cjs attest reuse|record|verify`
 * and `scripts/lesson-ast.cjs digest`).
 *
 *   ./check.cjs            # exit 0 only when every case passes
 *   KEEP=1 ./check.cjs     # keep the temp lesson roots and print their paths
 *
 * Node plus one dependency: `@babel/parser`, at the version
 * `references/bootstrap/lesson-template/` already pins, installed into a temp dir the way a lesson
 * installs it. No model calls, no browser, no manim, no lesson build.
 *
 * Every case builds its own lesson root, its own run records and its own artifacts under a fresh
 * temp dir, and asserts both the set that is re-reviewed and the set that is reused. No case reads
 * state another case left behind.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(SKILL, 'scripts', 'run-manifest.cjs');
const FIXTURE = path.join(__dirname, 'lesson');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attestation-'));

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
fs.writeFileSync(path.join(depRoot, 'package.json'), '{"name":"attestation-deps","private":true}\n');
{
  const r = spawnSync('npm', ['install', '--no-save', '--silent', '--prefer-offline', PARSER_SPEC],
    { cwd: depRoot, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`could not install ${PARSER_SPEC}:\n${r.stderr || r.stdout}\n`);
    process.exit(1);
  }
}
const DEP_MODULES = path.join(depRoot, 'node_modules');

// ---------- the fixture lesson, its media, and the spec that reviews them ----------

// Two file-backed media (a matplotlib figure source and the spectrum data it feeds), two graphs
// that live inside the one lesson file and share a helper, and a demo in that same file.
const DECAY = 'figures/decay.py';
const SPECTRUM = 'public/data/spectrum.json';
const LESSON_JSX = 'src/lesson.jsx';
const MODEL = 'test-reviewer-1';

const SPEC = {
  reviews: [
    // m1's own bytes; m2 is derived from them, so it depends on them.
    { media_id: 'm1', reviewer: 'visual-qa-agent', model: MODEL, rubric: 'review/visual-qa.rubric.md' },
    { media_id: 'm1', reviewer: 'scientific-accuracy-agent', model: MODEL, rubric: 'review/science.rubric.md' },
    { media_id: 'm2', reviewer: 'visual-qa-agent', model: MODEL, rubric: 'review/visual-qa.rubric.md',
      deps: [DECAY] },
    // The graphs are in the shared lesson file, so each attests to its own declaration.
    { media_id: 'm3', reviewer: 'visual-qa-agent', model: MODEL, rubric: 'review/visual-qa.rubric.md',
      artifacts: [`${LESSON_JSX}#WaveGraph`], deps: [`${LESSON_JSX}#axisTicks`, `${LESSON_JSX}#polarPath`] },
    { media_id: 'm3', reviewer: 'scientific-accuracy-agent', model: MODEL, rubric: 'review/science.rubric.md',
      artifacts: [`${LESSON_JSX}#WaveGraph`], deps: [`${LESSON_JSX}#axisTicks`, `${LESSON_JSX}#polarPath`] },
    { media_id: 'm4', reviewer: 'visual-qa-agent', model: MODEL, rubric: 'review/visual-qa.rubric.md',
      artifacts: [`${LESSON_JSX}#SpectrumGraph`], deps: [`${LESSON_JSX}#axisTicks`] },
    { media_id: 'm4', reviewer: 'scientific-accuracy-agent', model: MODEL, rubric: 'review/science.rubric.md',
      artifacts: [`${LESSON_JSX}#SpectrumGraph`], deps: [`${LESSON_JSX}#axisTicks`] },
    { media_id: 'm5', reviewer: 'visual-qa-agent', model: MODEL, rubric: 'review/visual-qa.rubric.md',
      artifacts: [`${LESSON_JSX}#Damping sandbox`] },
  ],
};
const ALL_REVIEWS = SPEC.reviews.map((r) => `${r.media_id}/${r.reviewer}`).sort();

const DECAY_V1 = 'import numpy as np\n\nT = np.linspace(0, 10, 200)\nY = np.exp(-0.2 * T)\n';
const DECAY_V2 = 'import numpy as np\n\nT = np.linspace(0, 10, 400)\nY = np.exp(-0.35 * T)\n';
const SPECTRUM_JSON = '{ "peak": 540, "width": 22 }\n';

/** A lesson root of this case's own, with a first run whose two file-backed media are promoted. */
function lesson(name) {
  const root = path.join(tmpRoot, name, 'PHYS201', 'claude_lessons', 'sample-lesson');
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.cpSync(FIXTURE, root, { recursive: true });
  fs.symlinkSync(DEP_MODULES, path.join(root, 'node_modules'), 'dir');
  const spec = path.join(root, 'attest-spec.json');
  fs.writeFileSync(spec, `${JSON.stringify(SPEC, null, 2)}\n`);
  return { root, spec };
}

function init(root, at) {
  const r = run(['init', '--lesson', root, '--mode', 'update', '--session-mode', 'headless',
    '--course', 'PHYS201', '--slug', 'sample-lesson', ...(at ? ['--at', at] : [])]);
  if (r.code !== 0) throw new Error(`init failed: ${r.err}`);
  return r.out;
}

/** Stage and promote `body` at `dest` for `mediaId`, the way a producer does. */
function produce(root, runId, mediaId, dest, body) {
  const staged = run(['stage', '--lesson', root, '--run', runId, '--media-id', mediaId,
    '--name', path.basename(dest)]);
  if (staged.code !== 0) throw new Error(`stage failed: ${staged.err}`);
  fs.writeFileSync(staged.out, body);
  const r = run(['promote', '--lesson', root, '--run', runId, '--media-id', mediaId,
    '--from', staged.out, '--to', dest]);
  if (r.code !== 0) throw new Error(`promote ${dest} failed: ${r.err}`);
}

/** The five media rows the plan carries, written the way Phase 2 writes them. */
function plannedMedia(root, runId) {
  const rows = [['m1', 'matplotlib', DECAY], ['m2', 'matplotlib', SPECTRUM], ['m3', 'svg', null],
    ['m4', 'svg', null], ['m5', 'interactive_demo', null]].map(([media_id, medium, dest]) =>
    ({ media_id, intent: 'keep', medium, topic: '1', path: dest, status: 'built' }));
  run(['set', '--lesson', root, '--run', runId, 'media', JSON.stringify(rows), '--json']);
}

function reuse(root, runId, spec, at) {
  const r = run(['attest', 'reuse', '--lesson', root, '--run', runId, '--spec', spec,
    ...(at ? ['--at', at] : [])]);
  if (r.code !== 0) throw new Error(`attest reuse failed (${r.code}): ${r.err}`);
  return JSON.parse(r.out);
}

const record = (root, runId, spec, mediaId, reviewer, verdict, at) =>
  run(['attest', 'record', '--lesson', root, '--run', runId, '--spec', spec,
    '--media-id', mediaId, '--reviewer', reviewer, '--verdict', verdict, ...(at ? ['--at', at] : [])]);

const verify = (root, runId, spec) =>
  run(['attest', 'verify', '--lesson', root, '--run', runId, '--spec', spec]);

const pairs = (list) => list.map((x) => `${x.media_id}/${x.reviewer}`).sort();
const readRecord = (root, runId) =>
  JSON.parse(fs.readFileSync(path.join(root, '.lesson-builder', 'runs', `${runId}.json`), 'utf8'));
const rowOf = (rec, id) => rec.media.find((m) => m.media_id === id);

/** Review everything the spec asks for, so the run ends with a verdict on every artifact. */
function reviewAll(root, runId, spec, decision, at) {
  for (const r of decision.review) record(root, runId, spec, r.media_id, r.reviewer, 'pass', at);
}

/**
 * A lesson whose first run reviewed everything — built once here and copied per case, the same way
 * `lesson()` copies the fixture tree. It is a fixture, not another case's leftovers: every case
 * that starts from a reviewed lesson gets its own copy and writes only into that.
 */
const BASE = (() => {
  const { root, spec } = lesson('_reviewed');
  const runA = init(root, '2026-04-01T09:00:00Z');
  plannedMedia(root, runA);
  produce(root, runA, 'm1', DECAY, DECAY_V1);
  produce(root, runA, 'm2', SPECTRUM, SPECTRUM_JSON);
  reviewAll(root, runA, spec, reuse(root, runA, spec, '2026-04-01T09:10:00Z'), '2026-04-01T09:20:00Z');
  return { root, runA };
})();

/** A copy of that lesson, for one case to change however it likes. */
function firstRun(name) {
  const root = path.join(tmpRoot, name, 'PHYS201', 'claude_lessons', 'sample-lesson');
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.cpSync(BASE.root, root, { recursive: true, verbatimSymlinks: true });
  return { root, spec: path.join(root, 'attest-spec.json'), runA: BASE.runA };
}

/** A second run in the same lesson, after `mutate` has changed something. */
function secondRun(root, spec, mutate, at) {
  const runB = init(root, at || '2026-04-02T09:00:00Z');
  plannedMedia(root, runB);
  if (mutate) mutate(runB);
  return { runB, decision: reuse(root, runB, spec, '2026-04-02T09:10:00Z') };
}

// ---------- 1. a run with no prior attestations behaves exactly as today ----------

function caseFirstRun() {
  process.stdout.write('1  a run with no prior attestations reviews everything and attests\n');
  const { root, spec } = lesson('first-run');
  const runA = init(root, '2026-04-01T09:00:00Z');
  plannedMedia(root, runA);
  produce(root, runA, 'm1', DECAY, DECAY_V1);
  produce(root, runA, 'm2', SPECTRUM, SPECTRUM_JSON);

  const decision = reuse(root, runA, spec, '2026-04-01T09:10:00Z');
  eq(pairs(decision.review), ALL_REVIEWS, 'every review runs');
  eq(decision.reuse, [], 'nothing is reused');
  eq([...new Set(decision.review.map((r) => r.reason))], ['no attestation'],
    'and the reason is that there is no attestation, not that nothing changed');

  const gate = verify(root, runA, spec);
  eq(gate.code, 8, 'before any verdict the coverage gate refuses');
  eq(JSON.parse(gate.out).gaps.length, SPEC.reviews.length, 'and names every review as a gap');

  reviewAll(root, runA, spec, decision, '2026-04-01T09:20:00Z');
  eq(verify(root, runA, spec).code, 0, 'with every verdict recorded the gate passes');

  const rec = readRecord(root, runA);
  eq(rec.media.filter((m) => (m.attestations || []).length).length, 5, 'all five media carry verdicts');
  const v = rowOf(rec, 'm1').attestations.find((a) => a.reviewer === 'visual-qa-agent');
  eq(v.model, MODEL, 'the verdict records which reviewer produced it');
  eq(v.verdict, 'pass', 'and what it decided');
  eq(v.rubric.ref, 'review/visual-qa.rubric.md', 'and the rubric that judged it');
  eq(v.rubric.sha256, crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'review/visual-qa.rubric.md'))).digest('hex'),
    'by the rubric bytes, not a version string somebody typed');
  eq(v.artifacts, [{ ref: DECAY, sha256: crypto.createHash('sha256').update(DECAY_V1).digest('hex') }],
    'the artifact ref defaults to the promoted path and carries its hash');
  ok(!v.from_run && !v.reused_at, 'a fresh verdict is not marked reused');

  const graph = rowOf(rec, 'm3').attestations[0];
  eq(graph.artifacts.map((a) => a.ref), [`${LESSON_JSX}#WaveGraph`],
    'an in-file graph attests to its own declaration');
  ok(graph.artifacts[0].sha256 !== graph.deps[0].sha256, 'hashed per declaration, not per file');
}

// ---------- 2. a second run after one artifact changed ----------

function caseChangedArtifact() {
  process.stdout.write('2  one artifact changed: it and what depends on it are reviewed, the rest reused\n');
  const { root, spec, runA } = firstRun('changed-artifact');
  const { runB, decision } = secondRun(root, spec, (id) => produce(root, id, 'm1', DECAY, DECAY_V2));

  eq(pairs(decision.review),
    ['m1/scientific-accuracy-agent', 'm1/visual-qa-agent', 'm2/visual-qa-agent'],
    'the changed artifact and the medium that depends on it are reviewed');
  eq(pairs(decision.reuse),
    ['m3/scientific-accuracy-agent', 'm3/visual-qa-agent', 'm4/scientific-accuracy-agent',
      'm4/visual-qa-agent', 'm5/visual-qa-agent'],
    'and everything nothing touched is reused');
  eq(decision.review.find((r) => r.media_id === 'm1').reason,
    `artifact ${DECAY} changed since the verdict`, 'm1 because its own bytes changed');
  eq(decision.review.find((r) => r.media_id === 'm2').reason,
    `dependency ${DECAY} changed since the verdict`, 'm2 because a dependency changed');

  eq(verify(root, runB, spec).code, 8, 'until the reviewed set is judged, the gate refuses');
  reviewAll(root, runB, spec, decision, '2026-04-02T09:20:00Z');
  eq(verify(root, runB, spec).code, 0, 'then every artifact ends the run with a valid verdict');

  const rec = readRecord(root, runB);
  const reused = rowOf(rec, 'm3').attestations[0];
  eq(reused.from_run, runA, 'a reused verdict says which run reviewed the artifact');
  eq(reused.at, '2026-04-01T09:20:00Z', 'and keeps the time the verdict was made');
  eq(reused.reused_at, '2026-04-02T09:10:00Z', 'beside the time this run carried it forward');
  const fresh = rowOf(rec, 'm1').attestations.find((a) => a.reviewer === 'visual-qa-agent');
  ok(!fresh.from_run, 'the re-reviewed artifact carries this run\'s own verdict');
  eq(fresh.artifacts[0].sha256, crypto.createHash('sha256').update(DECAY_V2).digest('hex'),
    'attesting to the new bytes');

  // Re-running the decision changes nothing: the run's own proof is already in its record.
  const again = reuse(root, runB, spec, '2026-04-02T09:30:00Z');
  eq(again.review, [], 'a second decision in the same run reviews nothing further');
  eq(pairs(again.reuse), ALL_REVIEWS, 'every review is covered');
  eq(readRecord(root, runB).media.find((m) => m.media_id === 'm1')
    .attestations.find((a) => a.reviewer === 'visual-qa-agent').from_run, undefined,
    'and this run does not report its own verdict as reused from itself');
}

// ---------- 3. a shared helper, and one declaration in a shared file ----------

function caseSharedHelper() {
  process.stdout.write('3  a shared helper invalidates exactly what uses it\n');
  const { root, spec } = firstRun('shared-helper');
  const file = path.join(root, LESSON_JSX);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('const step = (max - min) / count;', 'const step = (max - min) / Math.max(count, 1);'));
  const { decision } = secondRun(root, spec, null);

  eq(pairs(decision.review),
    ['m3/scientific-accuracy-agent', 'm3/visual-qa-agent', 'm4/scientific-accuracy-agent',
      'm4/visual-qa-agent'],
    'both graphs that use the helper are reviewed');
  eq(pairs(decision.reuse),
    ['m1/scientific-accuracy-agent', 'm1/visual-qa-agent', 'm2/visual-qa-agent', 'm5/visual-qa-agent'],
    'and the demo in the same file, and the file-backed media, are reused');
  eq(decision.review[0].reason, `dependency ${LESSON_JSX}#axisTicks changed since the verdict`,
    'named as the dependency that changed');
}

function caseOneDeclaration() {
  process.stdout.write('3b one declaration in a shared file invalidates only its own medium\n');
  const { root, spec } = firstRun('one-declaration');
  const file = path.join(root, LESSON_JSX);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('viewBox="0 0 320 180">\n      <path', 'viewBox="0 0 360 200">\n      <path'));
  const { runB, decision } = secondRun(root, spec, null);

  eq(pairs(decision.review), ['m3/scientific-accuracy-agent', 'm3/visual-qa-agent'],
    'only the graph whose declaration changed is reviewed');
  eq(pairs(decision.reuse),
    ['m1/scientific-accuracy-agent', 'm1/visual-qa-agent', 'm2/visual-qa-agent',
      'm4/scientific-accuracy-agent', 'm4/visual-qa-agent', 'm5/visual-qa-agent'],
    'the other graph and the demo in the very same file are reused');
  eq(decision.review[0].reason, `artifact ${LESSON_JSX}#WaveGraph changed since the verdict`,
    'because its own bytes changed');

}

function caseDeletedDependency() {
  process.stdout.write('3c a dependency that is gone sends its medium back to review, alone\n');
  const { root, spec } = firstRun('deleted-dependency');
  const file = path.join(root, LESSON_JSX);
  // `polarPath` is m3's declared dependency and nothing else's. Only the declaration goes, so
  // WaveGraph's own bytes are untouched and the dependency being gone is the only thing left that
  // can send m3 back.
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/\nfunction polarPath[\s\S]*?\n}\n/, '\n');
  ok(after !== before && !/function polarPath/.test(after), 'the dependency is deleted');
  ok(after.includes('polarPath(params.amplitude * 80, 3)'), 'and the graph that used it is not touched');
  fs.writeFileSync(file, after);
  const { decision } = secondRun(root, spec, null);

  const m3 = decision.review.filter((r) => r.media_id === 'm3');
  eq(m3.length, 2, 'a deleted dependency sends its medium back to review');
  ok(/polarPath/.test(m3[0].reason), 'naming the ref that is gone');
  ok(/no top-level declaration or demo of that name/.test(m3[0].reason),
    'and saying it is no longer declared');
  ok(!decision.review.some((r) => r.media_id === 'm4' || r.media_id === 'm5'),
    'and does not drag the rest of the file back with it');
}

// ---------- 4. the rubric ----------

function caseRubric() {
  process.stdout.write('4  changing a rubric invalidates exactly the reviews it judges\n');
  const { root, spec } = firstRun('rubric');
  const rubric = path.join(root, 'review/visual-qa.rubric.md');
  fs.appendFileSync(rubric, '\nAlso check that axis labels are not clipped.\n');
  const { decision } = secondRun(root, spec, null);

  eq(pairs(decision.review),
    ['m1/visual-qa-agent', 'm2/visual-qa-agent', 'm3/visual-qa-agent', 'm4/visual-qa-agent',
      'm5/visual-qa-agent'],
    'every review that names that rubric is reviewed again');
  eq(pairs(decision.reuse),
    ['m1/scientific-accuracy-agent', 'm3/scientific-accuracy-agent', 'm4/scientific-accuracy-agent'],
    'and the ones judged by the other rubric are reused');
  eq(decision.review[0].reason, 'rubric review/visual-qa.rubric.md changed since the verdict',
    'named as the rubric');
}

// ---------- 5. the reviewer ----------

function caseReviewer() {
  process.stdout.write('5  changing the reviewer invalidates exactly its own verdicts\n');
  const { root } = firstRun('reviewer');
  const spec2 = path.join(root, 'attest-spec-newmodel.json');
  fs.writeFileSync(spec2, JSON.stringify({
    reviews: SPEC.reviews.map((r) =>
      r.reviewer === 'visual-qa-agent' ? { ...r, model: 'test-reviewer-2' } : r),
  }, null, 2));
  const { decision } = secondRun(root, spec2, null);

  eq(pairs(decision.review),
    ['m1/visual-qa-agent', 'm2/visual-qa-agent', 'm3/visual-qa-agent', 'm4/visual-qa-agent',
      'm5/visual-qa-agent'],
    'the reviewer whose model changed reviews again');
  eq(pairs(decision.reuse),
    ['m1/scientific-accuracy-agent', 'm3/scientific-accuracy-agent', 'm4/scientific-accuracy-agent'],
    'the other reviewer\'s verdicts still hold');
  eq(decision.review[0].reason,
    `reviewer model changed (attested by ${MODEL}, now test-reviewer-2)`, 'named as the reviewer');
}

// ---------- 6. a tampered artifact ----------

function caseTampered() {
  process.stdout.write('6  an artifact edited without its record being updated is never reused\n');
  const { root, spec, runA } = firstRun('tampered');
  const before = rowOf(readRecord(root, runA), 'm1').artifacts[0].sha256;
  // Straight into the lesson tree: no stage, no promote, so the record still describes the old bytes.
  fs.writeFileSync(path.join(root, DECAY), DECAY_V2);
  const { runB, decision } = secondRun(root, spec, null);

  eq(rowOf(readRecord(root, runA), 'm1').artifacts[0].sha256, before,
    'the record still carries the hash of the bytes that were promoted');
  eq(pairs(decision.review),
    ['m1/scientific-accuracy-agent', 'm1/visual-qa-agent', 'm2/visual-qa-agent'],
    'and the tampered artifact is reviewed anyway, because the check hashes the file on disk');
  ok(!decision.reuse.some((r) => r.media_id === 'm1'), 'it is never reused');

  // The gate is on the bytes too: adopting a verdict and then editing the file fails verify.
  reviewAll(root, runB, spec, decision, '2026-04-02T09:20:00Z');
  eq(verify(root, runB, spec).code, 0, 'a run that reviewed the tampered artifact passes the gate');
  fs.writeFileSync(path.join(root, DECAY), `${DECAY_V2}# and again\n`);
  const gate = verify(root, runB, spec);
  eq(gate.code, 8, 'editing it after the verdict fails the gate');
  eq(pairs(JSON.parse(gate.out).gaps), ['m1/scientific-accuracy-agent', 'm1/visual-qa-agent',
    'm2/visual-qa-agent'], 'naming the artifact and what depends on it');
}

// ---------- 7. a record from before attestations existed ----------

function caseLegacyRecord() {
  process.stdout.write('7  a record from before this change makes the next run review everything\n');
  const { root, spec } = lesson('legacy-record');
  const runA = init(root, '2026-04-01T09:00:00Z');
  plannedMedia(root, runA);
  produce(root, runA, 'm1', DECAY, DECAY_V1);
  produce(root, runA, 'm2', SPECTRUM, SPECTRUM_JSON);
  // What Phase 4 wrote before verdicts attested to anything: findings, and no attestation anywhere.
  run(['append', '--lesson', root, '--run', runA, 'findings',
    JSON.stringify({ id: 'f1', phase: '4', origin: 'visual-qa', summary: 'x-axis label clipped',
      reason: 'low confidence, not attempted', state: 'open' })]);
  const legacy = readRecord(root, runA);
  ok(legacy.media.every((m) => !m.attestations), 'the old record carries no attestations');
  ok(legacy.findings.every((f) => !f.artifact_sha256), 'and its findings carry no artifact hash');

  const { runB, decision } = secondRun(root, spec, null);
  eq(pairs(decision.review), ALL_REVIEWS, 'so the next run reviews everything');
  eq(decision.reuse, [], 'and reuses nothing');
  reviewAll(root, runB, spec, decision, '2026-04-02T09:20:00Z');
  eq(verify(root, runB, spec).code, 0, 'and ends with a verdict on every artifact');
  eq(readRecord(root, runB).media.filter((m) => (m.attestations || []).length).length, 5,
    'which is now attested');
  eq(readRecord(root, runA).findings.length, 1, 'the old record is left as it was');
}

// ---------- 8. what is refused ----------

function caseRefusals() {
  process.stdout.write('8  a verdict is refused when it would attest to nothing\n');
  const { root, spec, runA } = firstRun('refusals');

  const unavailable = record(root, runA, spec, 'm1', 'visual-qa-agent', 'unavailable');
  eq(unavailable.code, 1, 'an unavailable reviewer is not a verdict');
  ok(/coverage gap/.test(unavailable.err), 'and says so');

  const unasked = record(root, runA, spec, 'm1', 'interaction-agent', 'pass');
  eq(unasked.code, 1, 'a verdict from a reviewer the spec never asked for is refused');
  ok(/no review of m1 by interaction-agent/.test(unasked.err), 'naming the pair');

  const bare = path.join(root, 'spec-no-artifact.json');
  fs.writeFileSync(bare, JSON.stringify({ reviews: [
    { media_id: 'm9', reviewer: 'visual-qa-agent', model: MODEL, rubric: 'review/visual-qa.rubric.md' }] }));
  const empty = run(['attest', 'reuse', '--lesson', root, '--run', runA, '--spec', bare]);
  eq(empty.code, 1, 'a review with no artifact and no promoted path is refused');
  ok(/nothing to attest to/.test(empty.err), 'because a verdict over no bytes proves nothing');

  const outside = path.join(root, 'spec-outside.json');
  fs.writeFileSync(outside, JSON.stringify({ reviews: [
    { media_id: 'm1', reviewer: 'visual-qa-agent', model: MODEL, rubric: 'review/visual-qa.rubric.md',
      artifacts: ['../../../etc/hostname'] }] }));
  const escaped = record(root, runA, outside, 'm1', 'visual-qa-agent', 'pass');
  eq(escaped.code, 1, 'a ref that leaves the lesson root is refused');
  ok(/not inside the lesson root/.test(escaped.err), 'saying so');

  const dupe = path.join(root, 'spec-dupe.json');
  fs.writeFileSync(dupe, JSON.stringify({ reviews: [SPEC.reviews[0], SPEC.reviews[0]] }));
  eq(run(['attest', 'reuse', '--lesson', root, '--run', runA, '--spec', dupe]).code, 1,
    'a spec that names the same review twice is refused');

  // The skill's own files are named `skill:<path>`, so a record holds no machine-specific path.
  const skillSpec = path.join(root, 'spec-skill.json');
  fs.writeFileSync(skillSpec, JSON.stringify({ reviews: [
    { media_id: 'm1', reviewer: 'visual-qa-agent', model: MODEL,
      rubric: 'skill:agents/visual-qa-agent.md', deps: ['skill:references/phase-4-review.md'] }] }));
  eq(record(root, runA, skillSpec, 'm1', 'visual-qa-agent', 'pass').code, 0,
    'a rubric and a reviewer prompt in the skill are hashed from the skill root');
  const v = rowOf(readRecord(root, runA), 'm1').attestations.find((a) => a.reviewer === 'visual-qa-agent');
  eq(v.rubric.ref, 'skill:agents/visual-qa-agent.md', 'and recorded by that portable ref');
  eq(v.rubric.sha256, crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(SKILL, 'agents', 'visual-qa-agent.md'))).digest('hex'),
    'over the skill file\'s bytes');
}

// ---------- 9. the rendered log ----------

function caseRender() {
  process.stdout.write('9  reuse is visible in the rendered log\n');
  const { root, spec, runA } = firstRun('render');
  const { runB, decision } = secondRun(root, spec, (id) => produce(root, id, 'm1', DECAY, DECAY_V2));
  reviewAll(root, runB, spec, decision, '2026-04-02T09:20:00Z');
  run(['render', '--lesson', root]);
  const log = fs.readFileSync(path.join(root, 'lesson_build.log.md'), 'utf8');

  ok(log.includes(`verdict: visual-qa-agent pass — ${MODEL}, attested 2026-04-01T09:20:00Z`),
    'the first run\'s verdicts render with the reviewer that made them');
  ok(log.includes(`verdict: visual-qa-agent pass — REUSED from run ${runA}, attested 2026-04-01T09:20:00Z`),
    'and the second run says which verdicts it reused and from where');
  ok(log.includes(`verdict: visual-qa-agent pass — ${MODEL}, attested 2026-04-02T09:20:00Z`),
    'while the artifact it re-reviewed carries this run\'s own verdict');
  eq((log.match(/REUSED from run/g) || []).length, 5, 'one reuse line per verdict carried forward');

  const before = log;
  run(['render', '--lesson', root]);
  eq(fs.readFileSync(path.join(root, 'lesson_build.log.md'), 'utf8'), before,
    're-rendering an unchanged record is byte-identical');
}

// ---------- run ----------

process.stdout.write(`attestation fixture (${SCRIPT})\n`);
const started = Date.now();
for (const c of [caseFirstRun, caseChangedArtifact, caseSharedHelper, caseOneDeclaration,
  caseDeletedDependency, caseRubric, caseReviewer, caseTampered, caseLegacyRecord, caseRefusals,
  caseRender]) c();

if (process.env.KEEP) process.stdout.write(`\nkept: ${tmpRoot}\n`);
else fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(
  `\n${checks - failures}/${checks} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
);
process.exit(failures ? 1 : 0);
