#!/usr/bin/env node
/**
 * Fixture for the run record (`scripts/run-manifest.cjs`): write, read, hash, render — and the
 * pre-record log — on tiny sample runs, no real lesson build, no network, no npm install.
 *
 *   ./check.cjs            # exit 0 only when every case passes
 *   KEEP=1 ./check.cjs     # keep the temp lesson roots and print their paths
 *
 * Every case builds its own lesson root under a fresh temp dir and asserts both the case that is
 * kept and the case that is suppressed. No case reads state another case left behind.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'run-manifest.cjs');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manifest-'));

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

/** A lesson root of this case's own, with nothing in it but what the case puts there. */
function lessonRoot(name) {
  const root = path.join(tmpRoot, name, 'MATH101', 'claude_lessons', 'sample-lesson');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const record = (root, runId) =>
  JSON.parse(fs.readFileSync(path.join(root, '.lesson-builder', 'runs', `${runId}.json`), 'utf8'));

function init(root, extra) {
  const r = run(['init', '--lesson', root, '--mode', 'new', '--session-mode', 'headless',
    '--course', 'MATH101', '--slug', 'sample-lesson', ...(extra || [])]);
  if (r.code !== 0) throw new Error(`init failed: ${r.err}`);
  return r.out;
}

function writePlan(root, text) {
  const p = path.join(root, 'plan.md');
  fs.writeFileSync(p, text);
  return p;
}

const cases = {};

// ---- 1. init writes a versioned record and never clobbers one ----
cases['init creates a versioned record and refuses to clobber'] = () => {
  const root = lessonRoot('init');
  const id = init(root, ['--run', 'aaa111', '--at', '2026-04-10T09:12:33Z']);
  eq(id, 'aaa111', 'init prints the run id');
  const rec = record(root, 'aaa111');
  eq(rec.schema, 'lesson-run/1', 'record carries the schema version');
  eq(rec.mode, 'new', 'mode recorded');
  eq(rec.session_mode, 'headless', 'session mode recorded');
  eq(rec.lesson.slug, 'sample-lesson', 'slug recorded');
  eq(rec.plan.approval.state, 'none', 'a fresh run has no approval');
  eq([rec.git.stash_oid, rec.git.base_sha, rec.git.branch], [null, null, null], 'git fields start empty');
  eq([rec.media, rec.findings], [[], []], 'media and findings start empty');

  const again = run(['init', '--lesson', root, '--mode', 'new', '--session-mode', 'headless', '--run', 'aaa111']);
  eq(again.code, 2, 'a second init on the same run id exits 2');
  eq(record(root, 'aaa111').started, '2026-04-10T09:12:33Z', 'the existing record is left as it was');
};

// ---- 2. set / get / append round-trip, and a missing field is an error not an empty string ----
cases['set, get and append round-trip every field the roadmap lists'] = () => {
  const root = lessonRoot('fields');
  init(root, ['--run', 'bbb222']);
  run(['set', '--lesson', root, 'git.base_sha', '7e4b9a2']);
  run(['set', '--lesson', root, 'git.branch', 'lesson-update/sample-lesson-20260415-a']);
  run(['set', '--lesson', root, 'git.stash_oid', 'c0ffee1']);
  run(['set', '--lesson', root, 'scoping.lesson_file', 'src/sample-lesson.jsx']);
  run(['append', '--lesson', root, 'media', '{"media_id":"m1","intent":"refine","original_intent":"add"}']);
  run(['append', '--lesson', root, 'media', '{"media_id":"m2","intent":"keep"}']);
  run(['append', '--lesson', root, 'findings', '{"summary":"axis label clipped","origin":"visual-qa","state":"open"}']);
  run(['set', '--lesson', root, 'phases.3.notes', '["Splice counts: refine=1"]', '--json']);

  eq(run(['get', '--lesson', root, 'git.base_sha']).out, '7e4b9a2', 'base SHA reads back');
  eq(run(['get', '--lesson', root, 'git.branch']).out,
    'lesson-update/sample-lesson-20260415-a', 'the branch reads back with its collision suffix');
  eq(run(['get', '--lesson', root, 'git.stash_oid']).out, 'c0ffee1', 'stash OID reads back');
  eq(record(root, 'bbb222').media.map((m) => m.media_id), ['m1', 'm2'], 'append keeps order');
  eq(record(root, 'bbb222').phases['3'].notes, ['Splice counts: refine=1'], '--json stores a real array');

  const missing = run(['get', '--lesson', root, 'git.nonesuch']);
  eq(missing.code, 3, 'a field that was never set exits 3 rather than printing nothing');
  const unset = run(['get', '--lesson', root, 'git.commit_sha']);
  eq([unset.code, unset.out], [3, ''],
    'a field init seeded as null exits 3 too — "no stash" must not read back as the string "null"');
  eq(run(['append', '--lesson', root, 'git.base_sha', '{"x":1}']).code, 1, 'append onto a non-array is an error');
};

// ---- 3. the plan hash is the documented hash ----
cases['plan-hash is the first 8 hex of the artifact SHA-256'] = () => {
  const root = lessonRoot('hash');
  init(root, ['--run', 'ccc333']);
  const text = '# Lesson Plan\n- Topic 1: limits\n';
  const expected = crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
  const hash = run(['plan-hash', '--lesson', root, '--file', writePlan(root, text)]);
  eq(hash.out, expected, 'the printed hash matches sha256sum | cut -c1-8');
  const rec = record(root, 'ccc333');
  eq(rec.plan.hash, expected, 'the hash is recorded');
  eq(rec.plan.artifact, 'plan.md', 'the artifact path is recorded, relative to the lesson root');
  eq(rec.plan.approval.state, 'pending', 'a hashed plan with no approval is pending');

  const revised = run(['plan-hash', '--lesson', root, '--file', writePlan(root, `${text}- Topic 2: rules\n`)]);
  ok(revised.out !== expected, 'a revised plan gets a different hash');
};

// ---- 3b. a plan revised after approval does not carry the approval with it ----
cases['revising an approved plan sends it back to the gate'] = () => {
  const root = lessonRoot('revised-after-approval');
  init(root, ['--run', 'ccc334']);
  const first = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A\n')]).out;
  run(['approve', '--lesson', root, '--hash', first, '--at', '2026-04-10T09:34:17Z']);
  const second = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A, one topic added\n')]).out;
  eq(record(root, 'ccc334').plan.approval.state, 'pending',
    'the approval does not transfer to text the user never saw');
  eq(run(['approve', '--lesson', root, '--hash', first]).code, 3, 'the old hash no longer approves');
  eq(run(['approve', '--lesson', root, '--hash', second]).code, 0, 'the revised plan needs its own approval');

  // Re-hashing the SAME bytes is not a revision and must not drop an approval.
  const root2 = lessonRoot('rehash-same');
  init(root2, ['--run', 'ccc335']);
  const h = run(['plan-hash', '--lesson', root2, '--file', writePlan(root2, 'plan A\n')]).out;
  run(['approve', '--lesson', root2, '--hash', h, '--at', '2026-04-10T09:34:17Z']);
  run(['plan-hash', '--lesson', root2, '--file', writePlan(root2, 'plan A\n')]);
  eq(record(root2, 'ccc335').plan.approval.state, 'approved', 'an unchanged plan keeps its approval');

  // An abort is not undone by editing the plan either.
  const root3 = lessonRoot('revised-after-abort');
  init(root3, ['--run', 'ccc336']);
  run(['plan-hash', '--lesson', root3, '--file', writePlan(root3, 'plan A\n')]);
  run(['set', '--lesson', root3, 'plan.approval',
    '{"state":"aborted","at":"2026-04-10T10:00:00Z","via":"user"}', '--json']);
  run(['plan-hash', '--lesson', root3, '--file', writePlan(root3, 'plan A revised\n')]);
  eq(record(root3, 'ccc336').plan.approval.state, 'aborted', 'a revision does not un-abort the run');
};

// ---- 4. the gate: the recorded hash approves ----
cases['approve at the recorded hash passes the gate once and stays put'] = () => {
  const root = lessonRoot('approve');
  init(root, ['--run', 'ddd444']);
  const hash = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A\n')]).out;
  const first = run(['approve', '--lesson', root, '--hash', hash, '--at', '2026-04-10T09:34:17Z']);
  eq(first.code, 0, 'a matching hash exits 0');
  const rec = record(root, 'ddd444');
  eq(rec.plan.approval.state, 'approved', 'the record says approved');
  eq(rec.plan.approval.via, `APPROVED PLAN ${hash}`, 'the record says what approved it');

  const second = run(['approve', '--lesson', root, '--hash', hash.toUpperCase(), '--at', '2027-01-01T00:00:00Z']);
  eq(second.code, 0, 'the same approval quoted in upper case still matches');
  eq(record(root, 'ddd444').plan.approval.at, '2026-04-10T09:34:17Z',
    "re-running the gate does not move the person's approval timestamp");
};

// ---- 5. the gate: a hash that is not the recorded hash is not approval ----
cases['approve at a stale or partial hash is refused and leaves the plan pending'] = () => {
  const root = lessonRoot('mismatch');
  init(root, ['--run', 'eee555']);
  const hash = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A\n')]).out;
  const revised = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A revised\n')]).out;

  const stale = run(['approve', '--lesson', root, '--hash', hash]);
  eq(stale.code, 3, 'the hash of the plan the user saw, after a revision, exits 3');
  ok(stale.err.includes(revised), 'the refusal names the hash that is current');
  eq(record(root, 'eee555').plan.approval.state, 'pending', 'a refused approval leaves the plan pending');

  eq(run(['approve', '--lesson', root, '--hash', revised.slice(0, 4)]).code, 3,
    'a prefix of the recorded hash is not the recorded hash');
  eq(run(['approve', '--lesson', root, '--hash', 'zzzzzzzz']).code, 3, 'a non-hex hash is not approval');
  eq(record(root, 'eee555').plan.approval.state, 'pending', 'still pending after both refusals');

  const good = run(['approve', '--lesson', root, '--hash', revised]);
  eq(good.code, 0, 'the current hash does approve');
};

// ---- 6. the gate: approved, but nothing recorded ----
cases['approve with no plan recorded is not approval'] = () => {
  const root = lessonRoot('nothing-recorded');
  init(root, ['--run', 'fff666']);
  const r = run(['approve', '--lesson', root, '--hash', '4f2a9c17']);
  eq(r.code, 4, 'an approval for a run that recorded no plan exits 4');
  ok(r.err.includes('no recorded plan'), 'the message says the record has no plan');
  const rec = record(root, 'fff666');
  eq(rec.plan.hash, null, 'no hash is invented from the task text');
  eq(rec.plan.approval.state, 'none', 'nothing is marked approved');
};

// ---- 7. an abort a person wrote is not un-written by the gate ----
cases['approve does not un-abort a run a person aborted'] = () => {
  const root = lessonRoot('aborted');
  init(root, ['--run', 'ggg777']);
  const hash = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A\n')]).out;
  run(['set', '--lesson', root, 'plan.approval',
    '{"state":"aborted","at":"2026-04-10T10:00:00Z","via":"user"}', '--json']);
  const r = run(['approve', '--lesson', root, '--hash', hash]);
  eq(r.code, 5, 'approving an aborted run exits 5 even at the right hash');
  eq(record(root, 'ggg777').plan.approval.state, 'aborted', 'the abort stands');
};

// ---- 7b. a consolidate run inherits the course plan's approval and renders its hash ----
cases['an inherited approval renders the consolidation hash, not this run\'s null plan hash'] = () => {
  const root = lessonRoot('inherited');
  init(root, ['--run', 'ggg778', '--at', '2026-04-15T14:00:00Z']);
  // A per-lesson consolidate run hashes no artifact of its own: `plan.hash` stays null and the
  // consolidation plan's hash lives in `via`.
  run(['set', '--lesson', root, 'plan.approval',
    '{"state":"inherited","at":"2026-04-15T14:02:08Z","via":"4f2a9c17"}', '--json']);
  const rec = record(root, 'ggg778');
  eq(rec.plan.approval.state, 'inherited', 'the record carries the inherited state the schema defines');
  eq(rec.plan.hash, null, 'a per-lesson consolidate run recorded no plan of its own');

  eq(run(['render', '--lesson', root]).code, 0, 'render exits 0');
  const log = fs.readFileSync(path.join(root, 'lesson_build.log.md'), 'utf8');
  ok(log.includes('Approval: INHERITED from consolidation plan 4f2a9c17 at 2026-04-15T14:02:08Z'),
    'the rendered line names the consolidation hash from `via`');
  ok(!log.includes('consolidation plan null'), 'and never the run\'s own null plan hash');
};

// ---- 8. render ----
cases['render writes the log from the record, headings and all'] = () => {
  const root = lessonRoot('render');
  init(root, ['--run', 'hhh888', '--at', '2026-04-10T09:12:33Z']);
  const hash = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A\n')]).out;
  run(['approve', '--lesson', root, '--hash', hash, '--at', '2026-04-10T09:34:17Z']);
  run(['set', '--lesson', root, 'git.branch', 'lesson-new/sample-lesson']);
  run(['set', '--lesson', root, 'git.base_sha', '7e4b9a2']);
  run(['set', '--lesson', root, 'git.commit_sha', '9c2d1f8']);
  run(['append', '--lesson', root, 'media', '{"media_id":"g1","intent":"add","medium":"svg-graph"}']);
  run(['append', '--lesson', root, 'findings', '{"summary":"tangent label clipped","origin":"visual-qa","state":"open"}']);
  run(['append', '--lesson', root, 'findings', '{"summary":"unused import","origin":"code-review","state":"resolved"}']);
  run(['set', '--lesson', root, 'phases.1.notes', '["Research rounds: 2"]', '--json']);

  eq(run(['render', '--lesson', root]).code, 0, 'render exits 0');
  const log = fs.readFileSync(path.join(root, 'lesson_build.log.md'), 'utf8');
  for (const heading of ['# Lesson Build Log — MATH101 / sample-lesson', '## Phase 0 — Scoping',
    '## Phase 1 — Content Analysis', '## Phase 2 — Plan', '## Phase 3 — Execution',
    '## Phase 4 — Review', '### UNRESOLVED', '## Phase 5 — Deploy', '## Final Report to User']) {
    ok(log.includes(heading), `the rendered log keeps the heading ${JSON.stringify(heading)}`);
  }
  ok(log.includes(`Approval: APPROVED via APPROVED PLAN ${hash} at 2026-04-10T09:34:17Z`),
    'the approval line is rendered from the record');
  ok(log.includes('Branch: lesson-new/sample-lesson'), 'the branch is rendered');
  ok(log.includes('Base SHA: 7e4b9a2'), 'the base SHA is rendered');
  ok(log.includes('Commit SHA: 9c2d1f8'), 'the commit SHA is rendered');
  ok(log.includes('g1 — intent: add'), 'media ride into the log with their intent');
  ok(log.includes('Research rounds: 2'), 'a phase note is rendered under its phase');
  ok(log.includes('tangent label clipped'), 'an open finding is listed under UNRESOLVED');
  ok(!log.includes('unused import'), 'a resolved finding is not listed as unresolved');

  // Rendering twice must not stack two copies of the same run.
  run(['render', '--lesson', root]);
  const again = fs.readFileSync(path.join(root, 'lesson_build.log.md'), 'utf8');
  eq(again.split('## Phase 3 — Execution').length - 1, 1, 're-rendering does not duplicate the run');
  eq(again, log, 're-rendering an unchanged record is byte-identical');
};

// ---- 9. a lesson whose log predates the record ----
cases['a log written before records exist is kept, and the update renders below it'] = () => {
  const root = lessonRoot('legacy');
  const legacy = [
    '# Lesson Build Log — MATH101 / sample-lesson',
    'Started: 2026-04-10T09:12:33-04:00',
    'Skill: lesson-builder v0.1.0',
    '',
    '## Phase 0 — Scoping',
    '- Detected mode: new',
    '- Hand-written note nobody should lose',
    '',
  ].join('\n');
  const logPath = path.join(root, 'lesson_build.log.md');
  fs.writeFileSync(logPath, legacy);

  const r = run(['init', '--lesson', root, '--mode', 'update', '--session-mode', 'headless',
    '--run', 'iii999', '--at', '2026-04-15T14:00:00Z', '--course', 'MATH101', '--slug', 'sample-lesson']);
  eq(r.code, 0, 'a run that finds no record starts one');
  run(['set', '--lesson', root, 'git.branch', 'lesson-update/sample-lesson-20260415']);
  run(['render', '--lesson', root]);

  const after = fs.readFileSync(logPath, 'utf8');
  ok(after.startsWith(legacy), 'the pre-record log is left exactly as it was, byte for byte');
  ok(after.includes('## Update 2026-04-15 (run-id: iii999)'), 'the update renders as its own section');
  ok(after.includes('### Phase 3 — Execution (update)'), 'update-mode phase headings are nested');
  ok(after.includes('Branch: lesson-update/sample-lesson-20260415'), 'the new run renders its branch');
  eq(after.split('Hand-written note nobody should lose').length - 1, 1,
    'the old note appears once, not rewritten and not duplicated');

  // A second render must not swallow the legacy prologue into the generated region.
  run(['render', '--lesson', root]);
  const twice = fs.readFileSync(logPath, 'utf8');
  eq(twice, after, 'rendering again leaves the file byte-identical');
  ok(twice.startsWith(legacy), 'the pre-record log survives a second render too');
};

// ---- 9b. the deploy triple survives to the next update without parsing the log ----
cases['the deploy destination is inherited from the prior run record, not from the log'] = () => {
  const root = lessonRoot('deploy-carry');
  init(root, ['--run', 'ddd001', '--at', '2026-04-10T09:00:00Z']);
  run(['set', '--lesson', root, 'scoping.deploy_action', 'push-to-custom']);
  run(['set', '--lesson', root, 'scoping.deploy_service_kind', 'cli']);
  run(['set', '--lesson', root, 'scoping.deploy_service', 'deploy-tool --prod']);
  run(['set', '--lesson', root, 'scoping.audience_level', 'first-year']);
  run(['render', '--lesson', root]);

  const log = fs.readFileSync(path.join(root, 'lesson_build.log.md'), 'utf8');
  const phase5 = log.slice(log.indexOf('## Phase 5 — Deploy'));
  const phase0 = log.slice(log.indexOf('## Phase 0 — Scoping'), log.indexOf('## Phase 1'));
  ok(phase5.includes('Deploy action: push-to-custom'), 'the deploy action renders under Phase 5');
  ok(phase5.includes('Deploy service kind: cli'), 'the service kind renders under Phase 5');
  ok(phase5.includes('Deploy service: deploy-tool --prod'), 'the service renders under Phase 5');
  ok(phase0.includes('audience_level: first-year'), 'other scoping fields still render under Phase 0');
  ok(!phase0.includes('deploy_action'), 'the deploy triple is not also dumped under Phase 0');
  ok(phase0.includes('Working tree state: clean'), 'no stash and no recorded word renders as clean');

  // A tree the user chose to discard is that word, not "clean", and is not dumped twice.
  const discarded = lessonRoot('discarded-tree');
  init(discarded, ['--run', 'ddd003', '--at', '2026-04-10T09:00:00Z']);
  run(['set', '--lesson', discarded, 'scoping.working_tree', 'discarded']);
  run(['render', '--lesson', discarded]);
  const dlog = fs.readFileSync(path.join(discarded, 'lesson_build.log.md'), 'utf8');
  ok(dlog.includes('Working tree state: discarded'), "a discarded tree renders as the word Phase 0 recorded");
  ok(!dlog.includes('Working tree state: clean'), 'and never as clean');
  eq(dlog.split('discarded').length - 1, 1, 'the word appears once, not also in a generic scoping dump');

  // The next update: `current` names the prior run BEFORE init, and `get --run` reads it back.
  const prior = run(['current', '--lesson', root]).out;
  eq(prior, 'ddd001', 'current names the prior run before the new one is opened');
  init(root, ['--run', 'ddd002', '--at', '2026-04-15T09:00:00Z']);
  eq(run(['get', '--lesson', root, '--run', prior, 'scoping.deploy_action']).out, 'push-to-custom',
    'the new run reads the destination off the prior record, not off the markdown');
  eq(run(['get', '--lesson', root, '--run', prior, 'scoping.deploy_service']).out, 'deploy-tool --prod',
    'and the service with it');
  eq(run(['get', '--lesson', root, 'scoping.deploy_action']).code, 3,
    'the new run has no destination of its own until Phase 0 sets one — never a silent default');
};

// ---- 10. resuming: `current` finds the run without being told its id ----
cases['current returns the newest run so a resumed session finds its record'] = () => {
  const root = lessonRoot('current');
  init(root, ['--run', 'jjj001', '--at', '2026-04-10T09:00:00Z']);
  eq(run(['current', '--lesson', root]).out, 'jjj001', 'one run is the current run');
  init(root, ['--run', 'kkk002', '--at', '2026-04-15T09:00:00Z']);
  eq(run(['current', '--lesson', root]).out, 'kkk002', 'the newer run wins');
  init(root, ['--run', 'aaa003', '--at', '2026-04-15T09:00:00Z']);
  eq(run(['current', '--lesson', root]).out, 'kkk002',
    'runs started in the same second tie-break on run id, not on directory order');
  // The gate, given no --run, must act on that same record.
  const hash = run(['plan-hash', '--lesson', root, '--file', writePlan(root, 'plan A\n')]).out;
  eq(record(root, 'kkk002').plan.hash, hash, 'plan-hash with no --run wrote to the current run');
  eq(record(root, 'jjj001').plan.hash, null, 'and not to the older one');
};

process.stdout.write(`run-manifest fixture (${SCRIPT})\n`);
for (const [name, fn] of Object.entries(cases)) {
  process.stdout.write(`- ${name}\n`);
  try {
    fn();
  } catch (e) {
    failures++;
    process.stdout.write(`  FAIL threw: ${e.message}\n`);
  }
}

if (process.env.KEEP) process.stdout.write(`\nkept: ${tmpRoot}\n`);
else fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
