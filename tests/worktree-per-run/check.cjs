#!/usr/bin/env node
/**
 * Fixture for worktree-per-run: an update run builds in a git worktree of its own, checked out from
 * the base SHA the record holds, and the user's working tree comes out byte-identical.
 *
 *   ./check.cjs            # exit 0 only when every case passes
 *   KEEP=1 ./check.cjs     # keep the temp repos and print their paths
 *
 * git and node only. No network, no npm install, no build. Every case builds its own repo, its own
 * lesson root and its own record, and asserts both the case that is kept and the case that is
 * refused. No case reads state another case left behind.
 *
 * The sequences driven here are the ones the docs state: `references/phase-0-scoping.md` § The base
 * SHA and the build worktree, `references/phase-3-execution.md` § Step 1, `references/phase-5-deploy.md`
 * § Step 2b, and `references/update-mode.md` § Recovering a run from the old stash flow.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(SKILL, 'scripts', 'run-manifest.cjs');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-per-run-'));

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

function git(cwd, args, allowFail) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail)
    throw new Error(`git ${args.join(' ')} in ${cwd}: ${(r.stderr || '').trim()}`);
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** A workspace repo of this case's own, with one lesson committed on `main` and a bare origin. */
function workspace(name) {
  const dir = path.join(tmpRoot, name);
  const origin = path.join(dir, 'origin.git');
  const repo = path.join(dir, 'workspace');
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(dir, ['init', '-q', '-b', 'main', repo]);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'user.name', 'fixture']);
  const lesson = path.join(repo, 'MATH101', 'claude_lessons', 'sample-lesson', 'src');
  fs.mkdirSync(lesson, { recursive: true });
  const root = path.dirname(lesson);
  // The lesson's own .gitignore is what makes the worktree and the records invisible to git.
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ndist/\n.build-scratch/\n.lesson-builder/\nlesson_build.log.md\n');
  fs.writeFileSync(path.join(lesson, 'sample-lesson.jsx'), 'export const TOPICS = ["one"];\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'lesson: initial']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  return { dir, repo, origin, root };
}

/**
 * Every byte of the user's working tree, hashed, plus git's view of it. `.lesson-builder/` is left
 * out: that directory is the run's own — records, staging, the worktree — and the lesson's
 * .gitignore covers it, which is why the user's `git status` (asserted here too) never sees it.
 */
function snapshot(repo) {
  const files = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(repo, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.git' || e.name === '.lesson-builder') continue;
      if (e.isDirectory()) walk(r);
      else if (e.isFile())
        files[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, r))).digest('hex');
    }
  };
  walk('');
  return {
    files,
    status: git(repo, ['status', '--short']).out,
    head: git(repo, ['rev-parse', 'HEAD']).out,
    branch: git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).out,
    index: git(repo, ['diff', '--cached', '--name-status']).out,
    stashes: git(repo, ['stash', 'list']).out,
  };
}

/** Phase 0: record the base branch + SHA and open the build worktree. Returns the build lesson root. */
function phase0(ws, runId, dirty) {
  run(['init', '--lesson', ws.root, '--mode', 'update', '--session-mode', 'headless', '--run', runId]);
  if (dirty) {
    fs.appendFileSync(path.join(ws.root, 'src', 'sample-lesson.jsx'), '// the user was mid-edit\n');
    fs.writeFileSync(path.join(ws.root, 'scratch-note.txt'), 'untracked, and theirs\n');
  }
  run(['set', '--lesson', ws.root, 'git.base_branch', 'main']);
  run(['set', '--lesson', ws.root, 'git.base_sha', git(ws.repo, ['rev-parse', 'refs/heads/main']).out]);
  const added = run(['worktree', 'add', '--lesson', ws.root]);
  if (added.code !== 0) throw new Error(`worktree add: ${added.err}`);
  return added.out;
}

const cases = {};

// ---- 1. the whole run, against a dirty tree ----
cases['an update run leaves the user’s working tree byte-identical, dirty files included'] = () => {
  const ws = workspace('full-run');
  const wt = phase0(ws, 'aaa111', true);
  const before = snapshot(ws.repo);
  ok(before.status.includes('scratch-note.txt') && before.status.includes('sample-lesson.jsx'),
    'the case starts from a genuinely dirty tree');

  // Phase 3: the branch is named inside the worktree, never in the user's checkout.
  const wtRepo = git(wt, ['rev-parse', '--show-toplevel']).out;
  git(wtRepo, ['config', 'user.email', 'fixture@example.invalid']);
  git(wtRepo, ['config', 'user.name', 'fixture']);
  git(wtRepo, ['checkout', '-q', '-b', 'lesson-update/sample-lesson-20260905']);
  run(['set', '--lesson', wt, 'git.branch', 'lesson-update/sample-lesson-20260905']);
  fs.writeFileSync(path.join(wt, 'src', 'sample-lesson.jsx'), 'export const TOPICS = ["one", "two"];\n');
  ok(git(ws.repo, ['branch', '--list', 'lesson-update/sample-lesson-20260905']).out.startsWith('+'),
    'the branch is checked out in the worktree (git marks it +), not in the user’s checkout');
  eq(snapshot(ws.repo).branch, 'main', 'the user’s checkout stayed on main the whole way through');

  // Phase 5: commit, merge and push, all in the worktree.
  git(wtRepo, ['add', '-A']);
  git(wtRepo, ['commit', '-qm', 'sample-lesson: update']);
  git(wtRepo, ['checkout', '-q', '--detach', 'main']);
  git(wtRepo, ['merge', '-q', '--no-ff', '-m', 'merge update', 'lesson-update/sample-lesson-20260905']);
  const merge = git(wtRepo, ['rev-parse', 'HEAD']).out;
  git(wtRepo, ['update-ref', 'refs/lesson-builder/aaa111/merge', merge]);
  const held = git(wtRepo, ['worktree', 'list', '--porcelain']).out.split('\n').includes('branch refs/heads/main');
  ok(held, 'the user’s checkout holds main, so the run must not move that ref');
  if (!held) git(wtRepo, ['update-ref', 'refs/heads/main', merge, git(wtRepo, ['rev-parse', `${merge}^1`]).out]);
  git(wtRepo, ['push', '-q', 'origin', `${merge}:main`]);
  run(['set', '--lesson', wt, 'git.commit_sha', merge]);
  eq(run(['worktree', 'remove', '--lesson', ws.root]).code, 0, 'the worktree prunes once its work is committed and kept by a ref');

  const after = snapshot(ws.repo);
  eq(after, before, 'every byte of the user’s working tree, its HEAD, its index and its stash list are as Phase 0 found them');
  eq(after.status, before.status,
    'and `git status` still shows exactly the two dirty paths — the worktree it built in is invisible');
  eq(after.stashes, '', 'nothing was ever stashed');
  eq(git(ws.repo, ['rev-parse', 'refs/heads/main']).out, before.head,
    'local main was not moved under the checkout that holds it');
  eq(git(ws.origin, ['rev-parse', 'refs/heads/main']).out, merge, 'the merge was published all the same');
  ok(git(ws.repo, ['merge-base', '--is-ancestor', before.head, merge], true).code === 0,
    'the merge fast-forwards the user’s main, which is what the report tells them to run');
  ok(!fs.existsSync(path.join(ws.root, '.lesson-builder', 'worktrees', 'aaa111')), 'the worktree directory is gone');
  eq(run(['get', '--lesson', ws.root, 'git.worktree_state']).out, 'removed', 'and the record says so');
};

// ---- 2. the record, from inside a worktree that cannot contain it ----
cases['a run inside the worktree finds the record the worktree does not contain'] = () => {
  const ws = workspace('pointer');
  const wt = phase0(ws, 'bbb222', false);
  ok(!fs.existsSync(path.join(wt, '.lesson-builder', 'runs')), 'the checkout of the base SHA holds no records');
  eq(run(['get', '--lesson', wt, 'git.base_branch']).out, 'main', 'a read given the worktree follows the pointer');
  run(['set', '--lesson', wt, 'phases.3.notes', '["spliced 1"]', '--json']);
  eq(run(['get', '--lesson', ws.root, 'phases.3.notes']).out, '["spliced 1"]',
    'and a write given the worktree lands in the one record');
  eq(run(['current', '--lesson', wt]).out, 'bbb222', 'the run id resolves from either root');

  const staged = run(['stage', '--lesson', wt, '--media-id', 'g1', '--name', 'g.png']);
  ok(staged.out.startsWith(path.join(ws.root, '.lesson-builder', 'staging')),
    'the staging area stays beside the records, not in the worktree');
  run(['render', '--lesson', wt]);
  ok(fs.existsSync(path.join(ws.root, 'lesson_build.log.md')), 'the rendered log stays beside the records');
  ok(!fs.existsSync(path.join(wt, 'lesson_build.log.md')), 'and not in the directory that gets pruned');
  const log = fs.readFileSync(path.join(ws.root, 'lesson_build.log.md'), 'utf8');
  ok(log.includes(`Worktree: ${wt} (live)`), 'the log names the worktree and its state');
  ok(!log.includes('Stash'), 'and carries no stash line at all, because no new run has one');

  // A pointer naming a lesson root that is itself a worktree is a loop.
  eq(run(['worktree', 'add', '--lesson', wt]).code, 1, 'worktree add against a worktree is refused');
  const second = path.join(ws.dir, 'second-lesson');
  fs.mkdirSync(path.join(second, '.lesson-builder'), { recursive: true });
  fs.writeFileSync(path.join(second, '.lesson-builder', 'record-root'), `${wt}\n`);
  const loop = run(['get', '--lesson', second, 'git.base_branch']);
  eq(loop.code, 1, 'a pointer naming another build worktree is refused rather than followed');
  ok(loop.err.includes('one place'), 'and says why');
};

// ---- 3. a crash at each phase boundary ----
cases['a crash between phases leaves the tree untouched and the run resumable'] = () => {
  const ws = workspace('crash');
  const wt = phase0(ws, 'ccc333', true);
  const before = snapshot(ws.repo);
  const wtRepo = git(wt, ['rev-parse', '--show-toplevel']).out;
  git(wtRepo, ['config', 'user.email', 'fixture@example.invalid']);
  git(wtRepo, ['config', 'user.name', 'fixture']);

  for (const phase of ['1', '2', '3']) {
    // A phase that is killed outright, part-way through writing its build into the worktree.
    const victim = spawnSync(process.execPath, ['-e',
      `require('fs').writeFileSync(${JSON.stringify(path.join(wt, 'src', 'sample-lesson.jsx'))},'half-writ');` +
      'process.kill(process.pid, "SIGKILL");']);
    eq(victim.signal, 'SIGKILL', `phase ${phase} really was killed`);
    eq(snapshot(ws.repo), before, `the user’s tree is untouched after the phase ${phase} crash`);
    // Resume: the record still names the base SHA and the worktree, and `worktree add` returns it.
    ok(run(['get', '--lesson', ws.root, 'git.base_sha']).out.length === 40, `phase ${phase}: the base SHA survives the crash`);
    const resumed = run(['worktree', 'add', '--lesson', ws.root]);
    eq([resumed.code, resumed.out], [0, wt], `phase ${phase}: the run resumes into the same worktree`);
    eq(fs.readFileSync(path.join(wt, 'src', 'sample-lesson.jsx'), 'utf8'), 'half-writ',
      `phase ${phase}: with the half-finished build still in it, not in the user’s tree`);
  }

  // The directory itself lost, the branch not: the resume puts the worktree back on the branch.
  git(wtRepo, ['checkout', '-q', '-b', 'lesson-update/sample-lesson-20260905']);
  git(wtRepo, ['add', '-A']);
  git(wtRepo, ['commit', '-qm', 'sample-lesson: half the update']);
  run(['set', '--lesson', ws.root, 'git.branch', 'lesson-update/sample-lesson-20260905']);
  const committed = git(wtRepo, ['rev-parse', 'HEAD']).out;
  fs.rmSync(path.join(ws.root, '.lesson-builder', 'worktrees', 'ccc333'), { recursive: true, force: true });
  const again = run(['worktree', 'add', '--lesson', ws.root]);
  eq(again.code, 0, 'a worktree whose directory is gone is re-created from the record');
  eq(git(wt, ['rev-parse', 'HEAD']).out, committed, 'on the recorded branch, with the commits it already carried');
  eq(snapshot(ws.repo), before, 'and the user’s tree is still byte-identical');
};

// ---- 4. a record from the old stash flow ----
cases['a record from the old stash flow is finished or rolled back by the documented path'] = () => {
  const ws = workspace('legacy');
  run(['init', '--lesson', ws.root, '--mode', 'update', '--session-mode', 'headless', '--run', 'ddd444']);
  // The old flow: stash the user's tree, build in their checkout on a new branch.
  fs.appendFileSync(path.join(ws.root, 'src', 'sample-lesson.jsx'), '// the user was mid-edit\n');
  fs.writeFileSync(path.join(ws.root, 'scratch-note.txt'), 'untracked, and theirs\n');
  const dirty = snapshot(ws.repo);
  git(ws.repo, ['stash', 'push', '-q', '--include-untracked', '-m', 'lesson-update-stash', '--', ws.root]);
  const oid = git(ws.repo, ['rev-parse', 'stash@{0}']).out;
  git(ws.repo, ['checkout', '-q', '-b', 'lesson-update/sample-lesson-20260901']);
  // Only a record written before this change has the stash fields; `set` refuses to write them now.
  for (const f of ['git.stash_oid', 'git.stash_ref', 'git.stash_branch']) {
    const refused = run(['set', '--lesson', ws.root, f, 'x']);
    eq(refused.code, 1, `set ${f} is refused — no new run writes one`);
  }
  const recPath = path.join(ws.root, '.lesson-builder', 'runs', 'ddd444.json');
  const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
  Object.assign(rec.git, { stash_oid: oid, stash_ref: 'stash@{0}', stash_branch: 'main',
    branch: 'lesson-update/sample-lesson-20260901' });
  fs.writeFileSync(recPath, `${JSON.stringify(rec, null, 2)}\n`);

  eq(run(['get', '--lesson', ws.root, 'git.stash_oid']).out, oid, 'recovery still reads the OID off the old record');
  eq(run(['get', '--lesson', ws.root, 'git.worktree']).code, 3,
    'and no worktree, which is how recovery tells an old record from a new one');
  eq(run(['worktree', 'remove', '--lesson', ws.root]).code, 3, 'there is no worktree to remove');

  // The documented recovery: back to the branch the stash was taken on, apply by OID, drop.
  git(ws.repo, ['checkout', '-q', rec.git.stash_branch]);
  eq(git(ws.repo, ['stash', 'apply', oid], true).code, 0, 'the stash applies by its OID, not by stash@{0}');
  // `drop` takes a stash-log entry, so the OID is resolved back to whichever `stash@{n}` it is now.
  const entry = git(ws.repo, ['stash', 'list', '--format=%H %gd']).out
    .split('\n').filter(Boolean).map((l) => l.split(' ')).find(([h]) => h === oid);
  ok(entry, 'the entry is re-found by its OID, not assumed to still be stash@{0}');
  git(ws.repo, ['stash', 'drop', '-q', entry[1]]);
  run(['set', '--lesson', ws.root, 'git.stash_recovery', `applied + dropped (${oid})`]);
  eq(snapshot(ws.repo), dirty, 'the user’s work is back exactly as it was before the old run stashed it');
  eq(git(ws.repo, ['stash', 'list']).out, '', 'and the stash entry is gone');
  eq(git(ws.repo, ['branch', '--list', 'lesson-update/sample-lesson-20260901']).out.trim(),
    'lesson-update/sample-lesson-20260901', 'the update branch is left in place, never force-deleted');

  run(['render', '--lesson', ws.root]);
  const log = fs.readFileSync(path.join(ws.root, 'lesson_build.log.md'), 'utf8');
  ok(log.includes(`Stash ref: stash@{0} (${oid}) — legacy, recovery only`),
    'the old record still renders its stash, marked legacy');
  ok(log.includes(`Stash recovery: applied + dropped (${oid})`), 'and the outcome recovery recorded');
};

// ---- 5. what `worktree remove` refuses ----
cases['worktree remove refuses to drop work, and prunes when a ref keeps it'] = () => {
  const ws = workspace('remove');
  const wt = phase0(ws, 'eee555', false);
  const wtRepo = git(wt, ['rev-parse', '--show-toplevel']).out;
  git(wtRepo, ['config', 'user.email', 'fixture@example.invalid']);
  git(wtRepo, ['config', 'user.name', 'fixture']);

  // deploy_action: skip — built, never committed.
  fs.writeFileSync(path.join(wt, 'src', 'sample-lesson.jsx'), 'export const TOPICS = ["one", "two"];\n');
  const dirtyRefusal = run(['worktree', 'remove', '--lesson', ws.root]);
  eq(dirtyRefusal.code, 7, 'a worktree holding an uncommitted build is not removed');
  ok(dirtyRefusal.err.includes('uncommitted'), 'and says what it is holding');
  ok(fs.existsSync(path.join(wt, 'src', 'sample-lesson.jsx')), 'the build is still there');
  eq(run(['get', '--lesson', ws.root, 'git.worktree_state']).out, 'live', 'and the record still calls it live');

  // A merge left on a detached HEAD that no ref keeps.
  git(wtRepo, ['checkout', '-q', '-b', 'lesson-update/sample-lesson-20260905']);
  git(wtRepo, ['add', '-A']);
  git(wtRepo, ['commit', '-qm', 'sample-lesson: update']);
  git(wtRepo, ['checkout', '-q', '--detach', 'main']);
  git(wtRepo, ['merge', '-q', '--no-ff', '-m', 'merge update', 'lesson-update/sample-lesson-20260905']);
  const merge = git(wtRepo, ['rev-parse', 'HEAD']).out;
  const danglingRefusal = run(['worktree', 'remove', '--lesson', ws.root]);
  eq(danglingRefusal.code, 7, 'a merge commit no ref keeps is not thrown away with the directory');
  ok(danglingRefusal.err.includes('no ref keeps'), 'and says why');

  git(wtRepo, ['update-ref', 'refs/lesson-builder/eee555/merge', merge]);
  eq(run(['worktree', 'remove', '--lesson', ws.root]).code, 0, 'once a ref keeps the merge, the worktree prunes');
  eq(git(ws.repo, ['rev-parse', 'refs/lesson-builder/eee555/merge']).out, merge, 'and the merge commit survives it');
  eq(run(['worktree', 'remove', '--lesson', ws.root]).code, 0, 'removing an already-removed worktree is a no-op');
};

// ---- 6. main is free: then the run does move it ----
cases['the base branch moves only when no working tree holds it'] = () => {
  const ws = workspace('free-main');
  const wt = phase0(ws, 'fff666', false);
  const wtRepo = git(wt, ['rev-parse', '--show-toplevel']).out;
  git(wtRepo, ['config', 'user.email', 'fixture@example.invalid']);
  git(wtRepo, ['config', 'user.name', 'fixture']);
  const base = git(ws.repo, ['rev-parse', 'refs/heads/main']).out;
  // The user is on a branch of their own, so nothing holds main.
  git(ws.repo, ['checkout', '-q', '-b', 'my-own-work']);
  const before = snapshot(ws.repo);

  git(wtRepo, ['checkout', '-q', '-b', 'lesson-update/sample-lesson-20260905']);
  fs.writeFileSync(path.join(wt, 'src', 'sample-lesson.jsx'), 'export const TOPICS = ["one", "two"];\n');
  git(wtRepo, ['add', '-A']);
  git(wtRepo, ['commit', '-qm', 'sample-lesson: update']);
  git(wtRepo, ['checkout', '-q', '--detach', 'main']);
  git(wtRepo, ['merge', '-q', '--no-ff', '-m', 'merge update', 'lesson-update/sample-lesson-20260905']);
  const merge = git(wtRepo, ['rev-parse', 'HEAD']).out;
  const held = git(wtRepo, ['worktree', 'list', '--porcelain']).out.split('\n').includes('branch refs/heads/main');
  ok(!held, 'no working tree holds main');
  eq(git(wtRepo, ['update-ref', 'refs/heads/main', merge, git(wtRepo, ['rev-parse', `${merge}^1`]).out], true).code,
    0, 'so the compare-and-swap moves it');
  eq(git(ws.repo, ['rev-parse', 'refs/heads/main']).out, merge, 'main is at the merge');
  eq(snapshot(ws.repo), before, 'and the user’s own checkout is still byte-identical');
  // The same compare-and-swap refuses once main has moved on.
  eq(git(wtRepo, ['update-ref', 'refs/heads/main', merge, base], true).code === 0, false,
    'a stale expected value is refused, not applied blind');
};

process.stdout.write(`worktree-per-run fixture (${SCRIPT})\n`);
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
