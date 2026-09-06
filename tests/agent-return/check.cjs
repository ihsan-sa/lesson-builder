#!/usr/bin/env node
/**
 * Malformed-agent-return evidence.
 *
 * Proof that the Phase 3 boundary refuses a specialist's return before the splice consumes it. A
 * manim or web-image agent stages and promotes its own artifact and then returns a JSON manifest —
 * `mp4_path`, `py_path`, `sha256`, `effective_action` — that assembly reads the `<video src>` out
 * of (`references/phase-3-execution.md` § Step 3, § Step 4). The gate is
 * `run-manifest.cjs check-return`; its rule is in that script's header.
 *
 * Node only. No manim, no model, no browser, no network, no npm install: each case builds its own
 * lesson root and its own promoted artifacts under a fresh temp dir, through the real `stage` and
 * `promote`. Runs in a few seconds. Exit code 0 only when every check passes. `KEEP=1` keeps the
 * temp roots and prints the path.
 *
 * What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(SKILL, 'scripts', 'run-manifest.cjs');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-return.'));

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function eq(what, got, want) { check(what, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function heading(n, text) { console.log(`\n${n}  ${text}`); }

const manifest = (cwd, args, stdin) =>
  (({ status, stdout, stderr }) => ({ code: status, out: (stdout || '').trim(), err: (stderr || '').trim() }))(
    spawnSync('node', [MANIFEST, ...args], { cwd, encoding: 'utf8', input: stdin === undefined ? '' : stdin }));

// A complete MP4: an `ftyp` box and a `moov` box whose lengths reach exactly the end, which is what
// `promote` validates before it will move one.
function mp4(payload) {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
  ftyp.writeUInt32BE(ftyp.length, 0);
  const body = Buffer.from(payload, 'utf8');
  const moov = Buffer.concat([Buffer.alloc(8), Buffer.from('moovdata'), body]);
  moov.writeUInt32BE(moov.length, 0);
  moov.write('moov', 4);
  return Buffer.concat([ftyp, moov]);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// One lesson root per case, each with its own run and its own promoted artifacts: a return is only
// ever judged against the record built beside it, never against one an earlier case left.
let made = 0;
function fixture(name, { py = 'from manim import *\n' } = {}) {
  const lesson = path.join(ROOT, `${String(++made).padStart(2, '0')}-${name}`);
  fs.mkdirSync(path.join(lesson, 'src'), { recursive: true });
  fs.writeFileSync(path.join(lesson, 'src', 'lesson.jsx'), 'export const TOPICS = [];\n');
  const runId = manifest(lesson, ['init', '--lesson', lesson, '--mode', 'update',
    '--session-mode', 'headless', '--at', '2026-04-15T09:30:00.000Z']).out;
  const mediaId = 'wave_packet';
  const run = (...args) => manifest(lesson, [...args, '--lesson', lesson, '--run', runId]);
  run('append', 'media', JSON.stringify({ media_id: mediaId, kind: 'manim', intent: 'replace', status: 'planned' }), '--json');

  const videoBytes = mp4(`scene for ${name}`);
  const pyBytes = Buffer.from(py, 'utf8');
  const stage = run('stage', '--media-id', mediaId, '--name', 'wave_packet.mp4').out;
  fs.writeFileSync(stage, videoBytes);
  run('promote', '--media-id', mediaId, '--from', stage, '--to', 'public/videos/wave_packet.mp4');
  const stagePy = run('stage', '--media-id', mediaId, '--name', 'wave_packet.py').out;
  fs.writeFileSync(stagePy, pyBytes);
  run('promote', '--media-id', mediaId, '--from', stagePy, '--to', 'wave_packet.py');

  return {
    lesson, runId, mediaId, run, videoBytes, pyBytes,
    // The return a well-behaved manim agent makes, which every case below mutates one thing of.
    good: () => ({
      mp4_path: 'public/videos/wave_packet.mp4',
      py_path: 'wave_packet.py',
      sha256: sha(videoBytes),
      effective_action: 'replace',
    }),
    // check-return with the manifest handed on stdin, the way a spawn's return arrives.
    judge: (text) => manifest(lesson, ['check-return', '--lesson', lesson, '--run', runId,
      '--media-id', mediaId], typeof text === 'string' ? text : JSON.stringify(text)),
  };
}
const untouched = (f) =>
  fs.readFileSync(path.join(f.lesson, 'public', 'videos', 'wave_packet.mp4')).equals(f.videoBytes)
  && fs.readFileSync(path.join(f.lesson, 'wave_packet.py')).equals(f.pyBytes);

// ---------------------------------------------------------------- 1
heading(1, 'the return a specialist is supposed to make');
{
  const f = fixture('good');
  const r = f.judge(f.good());
  eq('check-return exits 0', r.code, 0);
  const out = JSON.parse(r.out);
  eq('…and echoes the action it carried out', out.effective_action, 'replace');
  eq('…naming both promoted artifacts', out.artifacts.length, 2);
  check('…each with the hash the record holds, not the one the return claimed',
    out.artifacts.every((a) => a.sha256 === sha(a.path.endsWith('.py') ? f.pyBytes : f.videoBytes)),
    JSON.stringify(out.artifacts));
  check('the lesson tree is untouched', untouched(f));
  // A manifest with no `sha256` at all is complete: the field is optional, the paths are not.
  const noHash = f.good(); delete noHash.sha256;
  eq('a manifest that states no hash is still usable', f.judge(noHash).code, 0);
  for (const action of ['keep', 'refine', 'replace', 'remove', 'add']) {
    eq(`\`${action}\` is a verdict the taxonomy has`, f.judge({ ...f.good(), effective_action: action }).code, 0);
  }
}

// ---------------------------------------------------------------- 2
heading(2, 'a return that does not parse');
{
  const f = fixture('unparseable');
  const whole = JSON.stringify(f.good());
  const cases = [
    ['cut off part-way — the spawn died mid-write', whole.slice(0, Math.floor(whole.length / 2))],
    ['prose instead of a manifest', "I rendered the scene and promoted it to public/videos/wave_packet.mp4."],
    ['a manifest wrapped in a fenced code block', '```json\n' + whole + '\n```'],
    ['a manifest with a trailing apology', whole + '\n\nLet me know if you would like a different easing.'],
    ['nothing at all', ''],
    ['whitespace', '   \n\t\n'],
  ];
  for (const [what, text] of cases) {
    const r = f.judge(text);
    eq(`${what} exits 10`, r.code, 10);
    check(`…${what}: the reason names the media id`, r.err.includes(f.mediaId), r.err);
  }
  check('none of them wrote anything into the lesson tree', untouched(f));
  check('…or onto the media row',
    f.run('get', 'media').out.includes('"artifacts"') && !f.run('get', 'media').out.includes('artifact_failure'),
    f.run('get', 'media').out.slice(0, 200));
}

// ---------------------------------------------------------------- 3
heading(3, 'JSON that is not a manifest');
{
  const f = fixture('not-a-manifest');
  for (const [what, value] of [
    ['a JSON array of manifests', [f.good()]],
    ['a bare string', 'public/videos/wave_packet.mp4'],
    ['a number', 42],
    ['true', true],
  ]) {
    const r = f.judge(JSON.stringify(value));
    eq(`${what} exits 10`, r.code, 10);
  }
  // …except the one non-object the contract names: a web-image `refine` that found nothing better
  // returns a bare `null`, and main Claude treats that as a no-op (§ Step 3, refine).
  const nul = f.judge('null');
  eq('a bare `null` is the documented no-op, not a failure', nul.code, 0);
  eq('…reported as one', JSON.parse(nul.out).effective_action, 'no-op');
  eq('…claiming nothing', JSON.parse(nul.out).artifacts.length, 0);
  check('the lesson tree is untouched throughout', untouched(f));
}

// ---------------------------------------------------------------- 4
heading(4, 'an action the plan has no verdict for');
{
  const f = fixture('action');
  const missing = f.good(); delete missing.effective_action;
  eq('no `effective_action` at all exits 10', f.judge(missing).code, 10);
  for (const bad of ['rerender', 'REPLACE', '', null, 3, ['replace']]) {
    const r = f.judge({ ...f.good(), effective_action: bad });
    eq(`\`effective_action\`: ${JSON.stringify(bad)} exits 10`, r.code, 10);
    check(`…naming the five it could have been`, /keep, refine, replace, remove, add/.test(r.err), r.err);
  }
}

// ---------------------------------------------------------------- 5
heading(5, 'a path the run never promoted');
{
  const f = fixture('paths');
  // The file is really there — written straight into the lesson tree, past the staging area that
  // would have validated it. This is the one the record catches and a file-exists check does not.
  fs.writeFileSync(path.join(f.lesson, 'public', 'videos', 'smuggled.mp4'), mp4('written behind the staging area'));
  const smuggled = f.judge({ ...f.good(), mp4_path: 'public/videos/smuggled.mp4' });
  eq('a path this run never promoted exits 10', smuggled.code, 10);
  check('…even though the file is there', fs.existsSync(path.join(f.lesson, 'public', 'videos', 'smuggled.mp4')));
  check('…and the refusal names what the run did promote',
    smuggled.err.includes('public/videos/wave_packet.mp4'), smuggled.err);

  const gone = f.judge({ ...f.good(), mp4_path: 'public/videos/never_written.mp4' });
  eq('a path that is not there at all exits 10', gone.code, 10);

  for (const bad of ['../../../etc/passwd', '/etc/passwd', 'public/../../escape.mp4']) {
    const r = f.judge({ ...f.good(), mp4_path: bad });
    eq(`\`mp4_path\`: ${JSON.stringify(bad)} exits 10`, r.code, 10);
  }
  const empty = f.judge({ ...f.good(), mp4_path: '' });
  eq('an empty path exits 10', empty.code, 10);
  const notString = f.judge({ ...f.good(), mp4_path: { path: 'public/videos/wave_packet.mp4' } });
  eq('a path that is not a string exits 10', notString.code, 10);
  const none = f.judge({ effective_action: 'replace' });
  eq('a manifest naming no path at all exits 10', none.code, 10);
  check('…saying the splice has nothing to point at', /no path/.test(none.err), none.err);
  check('the lesson tree still holds the artifacts the run promoted', untouched(f));
}

// ---------------------------------------------------------------- 6
heading(6, 'a manifest that forgets half of what it produced');
{
  // The failure the other direction: the video is described, the `.py` beside it is not, and the
  // splice updates the <video src> while the source the next refine needs goes unrecorded.
  const f = fixture('half');
  const halfOnly = f.good(); delete halfOnly.py_path;
  const r = f.judge(halfOnly);
  eq('a manifest that names only the video exits 10', r.code, 10);
  check('…naming the artifact it left out', r.err.includes('wave_packet.py'), r.err);
  const nulled = f.judge({ ...f.good(), py_path: null });
  eq('…and a `py_path` explicitly nulled is the same omission', nulled.code, 10);
  eq('naming both is what passes', f.judge(f.good()).code, 0);
  // A media id nothing planned: the return describes a medium this run does not ship.
  const stray = manifest(f.lesson, ['check-return', '--lesson', f.lesson, '--run', f.runId,
    '--media-id', 'not_planned'], JSON.stringify(f.good()));
  eq('a media id with no row exits 10', stray.code, 10);
}

// ---------------------------------------------------------------- 7
heading(7, 'a hash that is not the hash of those bytes');
{
  const f = fixture('hash');
  const wrong = f.judge({ ...f.good(), sha256: sha(Buffer.from('some other render')) });
  eq('a hash matching neither file exits 10', wrong.code, 10);
  check('…naming the files it could have been', /wave_packet\.mp4/.test(wrong.err), wrong.err);
  for (const bad of ['deadbeef', 'not a hash', 12345, sha(f.videoBytes) + 'ff']) {
    eq(`\`sha256\`: ${JSON.stringify(bad)} exits 10`, f.judge({ ...f.good(), sha256: bad }).code, 10);
  }
  eq('the same hash upper-cased is the same hash', f.judge({ ...f.good(), sha256: sha(f.videoBytes).toUpperCase() }).code, 0);
  eq('the `.py`\'s hash is a hash of one of the files it names', f.judge({ ...f.good(), sha256: sha(f.pyBytes) }).code, 0);
  eq('an explicitly null hash is no claim at all', f.judge({ ...f.good(), sha256: null }).code, 0);

  // The bytes changed after the promotion, so the record's hash is stale. The check reads disk.
  fs.writeFileSync(path.join(f.lesson, 'public', 'videos', 'wave_packet.mp4'), mp4('re-rendered behind the record'));
  const stale = f.judge(f.good());
  eq('a hash that was right when it was promoted and is not now exits 10', stale.code, 10);
}

// ---------------------------------------------------------------- 8
heading(8, 'a production the run already recorded as failed');
{
  const f = fixture('failed');
  f.run('fail', '--media-id', f.mediaId, '--reason', 'manim exited 1 on the dry run');
  const r = f.judge(f.good());
  eq('a manifest for a media row carrying a failure exits 10', r.code, 10);
  check('…quoting the reason the run recorded', r.err.includes('manim exited 1'), r.err);
}

// ---------------------------------------------------------------- 9
heading(9, 'how the return is handed over');
{
  const f = fixture('io');
  const file = path.join(ROOT, 'return.json');
  fs.writeFileSync(file, JSON.stringify(f.good()) + '\n');
  const fromFile = manifest(f.lesson, ['check-return', '--lesson', f.lesson, '--run', f.runId,
    '--media-id', f.mediaId, '--from', file]);
  eq('--from a file works', fromFile.code, 0);
  check('…answering the same as stdin', fromFile.out === f.judge(f.good()).out, fromFile.out);
  const noFile = manifest(f.lesson, ['check-return', '--lesson', f.lesson, '--run', f.runId,
    '--media-id', f.mediaId, '--from', path.join(ROOT, 'nope.json')]);
  check('--from a file that is not there is a usage error, not a verdict', noFile.code === 1, `exit ${noFile.code}`);
  const noId = manifest(f.lesson, ['check-return', '--lesson', f.lesson, '--run', f.runId], '{}');
  check('no --media-id is a usage error', noId.code === 1, `exit ${noId.code}`);
}

console.log('');
for (const f of failures) console.log(`  FAIL  ${f}`);
console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (process.env.KEEP) console.log(`kept ${ROOT}`);
else fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
