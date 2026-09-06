#!/usr/bin/env node
/**
 * Branch-collision evidence.
 *
 * Proof that an update run whose branch name is already taken lands on a deterministic one, in its
 * own worktree, and that the name Phase 5 merges is the name that was created. The rule:
 * `references/checklists.md` § Update-mode pre-flight ("increment with a suffix (`-a`, `-b`) ...
 * Collision handling must be deterministic so the Phase 5 merge target is unambiguous"), the
 * format `references/update-mode.md` § Branch name format, the command `run-manifest.cjs branch`.
 *
 * git and node only. No network, no npm install, no build, no browser. Each case builds its own
 * workspace repo and its own record under a fresh temp dir. Runs in a few seconds. Exit code 0
 * only when every check passes. `KEEP=1` keeps the temp repos and prints the path.
 *
 * What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(SKILL, 'scripts', 'run-manifest.cjs');
const GITIGNORE = path.join(SKILL, 'references', 'bootstrap', 'lesson-template', '.gitignore');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-collision.'));

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function eq(what, got, want) { check(what, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function heading(n, text) { console.log(`\n${n}  ${text}`); }

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const git = (cwd, ...args) => sh('git', args, cwd);
const manifest = (cwd, ...args) => sh('node', [MANIFEST, ...args], cwd);

// One workspace per case: its own repo, its own lesson, its own record. Nothing here reads state a
// previous case left behind — a suffix that only appears because case 2 ran first would prove
// nothing about a run that meets the collision on its own.
let made = 0;
function workspace(name, { started = '2026-04-15T09:30:00.000Z' } = {}) {
  const repo = path.join(ROOT, `${String(++made).padStart(2, '0')}-${name}`);
  const lesson = path.join(repo, 'course', 'claude_lessons', 'intro-derivatives');
  fs.mkdirSync(path.join(lesson, 'src'), { recursive: true });
  fs.copyFileSync(GITIGNORE, path.join(lesson, '.gitignore'));
  fs.writeFileSync(path.join(lesson, 'src', 'intro_derivatives.jsx'), 'export const TOPICS = [];\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'user.name', 'Fixture');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lesson');
  const runId = manifest(repo, 'init', '--lesson', lesson, '--mode', 'update',
    '--session-mode', 'headless', '--at', started).out;
  const sha = git(repo, 'rev-parse', 'HEAD').out;
  manifest(repo, 'set', '--lesson', lesson, '--run', runId, 'git.base_sha', sha);
  return { repo, lesson, runId, sha };
}
const addWorktree = (ws) => manifest(ws.repo, 'worktree', 'add', '--lesson', ws.lesson, '--run', ws.runId).out;
const recorded = (ws) => manifest(ws.repo, 'get', '--lesson', ws.lesson, '--run', ws.runId, 'git.branch');
const branches = (repo) => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').out.split('\n').filter(Boolean).sort();

// ---------------------------------------------------------------- 1
heading(1, 'no collision: the plain name, in the worktree, from the base SHA');
{
  const ws = workspace('plain');
  const wt = addWorktree(ws);
  const before = branches(ws.repo);
  const r = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId);
  eq('branch exits 0', r.code, 0);
  eq('…and prints the name it created', r.out, 'lesson-update/intro-derivatives-20260415');
  eq('…which is the date on the run record, not today', r.out.slice(-8), '20260415');
  eq('the record carries that exact name', recorded(ws).out, r.out);
  check('the branch exists', branches(ws.repo).includes(r.out));
  check('…and is the only one added', JSON.stringify(branches(ws.repo)) === JSON.stringify([...before, r.out].sort()),
    JSON.stringify(branches(ws.repo)));
  const wtRoot = git(wt, 'rev-parse', '--show-toplevel').out;
  eq('the worktree is on it', git(wtRoot, 'symbolic-ref', '--short', 'HEAD').out, r.out);
  eq('…starting exactly at the recorded base SHA', git(ws.repo, 'rev-parse', r.out).out, ws.sha);
  eq("the user's checkout is still on main", git(ws.repo, 'symbolic-ref', '--short', 'HEAD').out, 'main');
  eq("…and their working tree is clean", git(ws.repo, 'status', '--porcelain').out, '');
}

// ---------------------------------------------------------------- 2
heading(2, 'a real collision: the name is taken, so the run takes -a');
{
  const ws = workspace('taken');
  // Taken the way it really gets taken: a previous update run of this lesson on the same day.
  git(ws.repo, 'branch', 'lesson-update/intro-derivatives-20260415', ws.sha);
  const wt = addWorktree(ws);
  const r = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId);
  eq('branch exits 0', r.code, 0);
  eq('…on the first free suffix', r.out, 'lesson-update/intro-derivatives-20260415-a');
  check('…and says on stderr which name was already there',
    r.err.includes('lesson-update/intro-derivatives-20260415 already exist'), r.err);
  eq('the record carries the suffixed name, which is what Phase 5 merges', recorded(ws).out, r.out);
  eq('the branch that was already there is untouched',
    git(ws.repo, 'rev-parse', 'lesson-update/intro-derivatives-20260415').out, ws.sha);
  const wtRoot = git(wt, 'rev-parse', '--show-toplevel').out;
  eq('the worktree is on the suffixed branch', git(wtRoot, 'symbolic-ref', '--short', 'HEAD').out, r.out);
}

// ---------------------------------------------------------------- 2b
heading('2b', 'the plain name and -a taken: -b, and the order does not depend on git');
{
  const ws = workspace('taken-two');
  // Created out of order on purpose: the suffix picked is the first free one in a…z, never the
  // one that happens to sort first or last in `for-each-ref`.
  git(ws.repo, 'branch', 'lesson-update/intro-derivatives-20260415-a', ws.sha);
  git(ws.repo, 'branch', 'lesson-update/intro-derivatives-20260415', ws.sha);
  addWorktree(ws);
  const r = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId);
  eq('branch exits 0', r.code, 0);
  eq('…on -b', r.out, 'lesson-update/intro-derivatives-20260415-b');
  eq('the record carries it', recorded(ws).out, r.out);

  // And with -b free but -c taken, it is still -b: the first gap, not the end of the list.
  const gap = workspace('gap');
  for (const s of ['', '-a', '-c']) git(gap.repo, 'branch', `lesson-update/intro-derivatives-20260415${s}`, gap.sha);
  addWorktree(gap);
  const g = manifest(gap.repo, 'branch', '--lesson', gap.lesson, '--run', gap.runId);
  eq('a gap in the suffixes is filled rather than skipped', g.out, 'lesson-update/intro-derivatives-20260415-b');
}

// ---------------------------------------------------------------- 3
heading(3, 'the same run asking twice');
{
  const ws = workspace('resume');
  git(ws.repo, 'branch', 'lesson-update/intro-derivatives-20260415', ws.sha);
  const wt = addWorktree(ws);
  const first = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId).out;
  const wtRoot = git(wt, 'rev-parse', '--show-toplevel').out;
  // Phase 3 crashed after the branch and after a commit, and the run resumes.
  fs.writeFileSync(path.join(wtRoot, 'course', 'claude_lessons', 'intro-derivatives', 'src', 'intro_derivatives.jsx'),
    'export const TOPICS = [1];\n');
  git(wtRoot, 'add', '-A');
  git(wtRoot, 'commit', '-qm', 'half a splice');
  const head = git(wtRoot, 'rev-parse', 'HEAD').out;
  git(wtRoot, 'checkout', '-q', '--detach', ws.sha);   // …and the resume finds HEAD moved off it

  const again = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId);
  eq('a second call exits 0', again.code, 0);
  eq('…and answers with the branch the run already has', again.out, first);
  eq('…rather than opening a second one beside it', branches(ws.repo).filter((b) => b.startsWith('lesson-update/')).length, 2);
  eq('the worktree is put back on it', git(wtRoot, 'symbolic-ref', '--short', 'HEAD').out, first);
  eq('…with the commit it already carried still there', git(ws.repo, 'rev-parse', first).out, head);
}

// ---------------------------------------------------------------- 4
heading(4, 'what is refused');
{
  const ws = workspace('refusals');
  // No worktree yet: the branch is never created in the user's checkout.
  const noWt = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId);
  eq('with no worktree recorded, branch exits 3', noWt.code, 3);
  check('…saying to add one first', /worktree add/.test(noWt.err), noWt.err);
  eq('…and creates nothing', branches(ws.repo).join(','), 'main');

  addWorktree(ws);
  // A record that names a branch somebody deleted. Opening a different one silently would leave
  // Phase 5 merging a name the record does not hold.
  manifest(ws.repo, 'set', '--lesson', ws.lesson, '--run', ws.runId, 'git.branch', 'lesson-update/gone');
  const gone = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId);
  eq('a recorded branch that no longer exists exits 3', gone.code, 3);
  check('…naming it', gone.err.includes('lesson-update/gone'), gone.err);
  eq('…and creates nothing', branches(ws.repo).join(','), 'main');
  eq('…and leaves the record saying what it said', recorded(ws).out, 'lesson-update/gone');

  // Every suffix taken. A machine does not invent a 27th name.
  const full = workspace('exhausted');
  for (const s of ['', ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `-${c}`)])
    git(full.repo, 'branch', `lesson-update/intro-derivatives-20260415${s}`, full.sha);
  addWorktree(full);
  const ex = manifest(full.repo, 'branch', '--lesson', full.lesson, '--run', full.runId);
  eq('the plain name and every -a…-z suffix taken exits 9', ex.code, 9);
  check('…saying how to name it instead', /--name/.test(ex.err), ex.err);
  eq('…and adds no branch', branches(full.repo).length, 28);
  eq('…and records none', manifest(full.repo, 'get', '--lesson', full.lesson, '--run', full.runId, 'git.branch').code, 3);

  // A name that would escape refs/heads or the lesson's own namespace.
  const bad = workspace('bad-name');
  addWorktree(bad);
  for (const name of ['../../etc/passwd', '-rf', 'a/../../b']) {
    const r = manifest(bad.repo, 'branch', '--lesson', bad.lesson, '--run', bad.runId, '--name', name);
    check(`--name ${JSON.stringify(name)} is refused`, r.code !== 0, `exit ${r.code}`);
  }
  eq('…and none of them created a branch', branches(bad.repo).join(','), 'main');
}

// ---------------------------------------------------------------- 5
heading(5, 'a remote-tracking ref of the same name is not a collision');
{
  const ws = workspace('remote');
  // The lesson was updated once and pushed, so origin carries the name. The checklist asks
  // whether it exists LOCALLY: `checkout -b` is not blocked by a remote-tracking ref, and calling
  // this a collision would push every re-run of a pushed lesson onto a suffix nobody asked for.
  git(ws.repo, 'update-ref', 'refs/remotes/origin/lesson-update/intro-derivatives-20260415', ws.sha);
  addWorktree(ws);
  const r = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId);
  eq('the plain name is taken', r.out, 'lesson-update/intro-derivatives-20260415');
  eq('…and it is a local branch now', git(ws.repo, 'rev-parse', `refs/heads/${r.out}`).out, ws.sha);
}

// ---------------------------------------------------------------- 6
heading(6, 'called from inside the worktree, as Phase 3 does');
{
  const ws = workspace('from-worktree');
  git(ws.repo, 'branch', 'lesson-update/intro-derivatives-20260415', ws.sha);
  const wt = addWorktree(ws);
  // Phase 3 runs in the worktree, whose lesson root holds a `record-root` pointer and no records.
  check('the worktree lesson root has no records of its own',
    !fs.existsSync(path.join(wt, '.lesson-builder', 'runs')));
  const r = manifest(wt, 'branch', '--lesson', wt, '--run', ws.runId);
  eq('branch exits 0 against the worktree lesson root', r.code, 0);
  eq('…with the same suffixed name', r.out, 'lesson-update/intro-derivatives-20260415-a');
  eq('…and the one record, beside the user lesson root, carries it', recorded(ws).out, r.out);
}

// ---------------------------------------------------------------- 7
heading(7, 'the log renders the name that was created');
{
  const ws = workspace('render');
  git(ws.repo, 'branch', 'lesson-update/intro-derivatives-20260415', ws.sha);
  addWorktree(ws);
  const name = manifest(ws.repo, 'branch', '--lesson', ws.lesson, '--run', ws.runId).out;
  eq('the run is on the suffix', name, 'lesson-update/intro-derivatives-20260415-a');
  manifest(ws.repo, 'render', '--lesson', ws.lesson, '--run', ws.runId);
  const log = fs.readFileSync(path.join(ws.lesson, 'lesson_build.log.md'), 'utf8');
  check('the log names the branch the run is actually on', log.includes(`Branch: ${name}`),
    (log.match(/Branch:.*/) || ['no Branch line'])[0]);
  check('…and never the plain name it collided with',
    !/Branch: lesson-update\/intro-derivatives-20260415$/m.test(log));
}

console.log('');
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (process.env.KEEP) console.log(`kept ${ROOT}`);
else fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
