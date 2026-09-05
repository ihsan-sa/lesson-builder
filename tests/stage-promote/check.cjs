#!/usr/bin/env node
/**
 * Fixture for stage-validate-promote (`scripts/run-manifest.cjs stage|promote|fail`, and the
 * manim pipeline's promote step in `_lesson-core/helpers/manim-runner.js`).
 *
 *   ./check.cjs            # exit 0 only when every case passes
 *   KEEP=1 ./check.cjs     # keep the temp lesson roots and print their paths
 *
 * Node only: no manim, no ffmpeg, no browser, no network, no npm install. The manim cases drive
 * the real pipeline against shell stubs for `manim`/`ffmpeg`/`ffprobe` put on PATH by this file.
 *
 * Every case builds its own lesson root and its own artifacts under a fresh temp dir, and asserts
 * both what is promoted and what is refused. No case reads state another case left behind.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const SKILL = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(SKILL, 'scripts', 'run-manifest.cjs');
const HELPERS = path.join(SKILL, 'references', 'bootstrap', '_lesson-core', 'helpers');
const RUNNER = path.join(HELPERS, 'manim-runner.js');
// The runner scratches under its own directory, one dir per call. Whatever this fixture's calls
// create there is removed afterwards; whatever was there before is left alone.
const SCRATCH = path.join(HELPERS, 'manim_scratch');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-promote-'));

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

/** A lesson root of this case's own, with a run record and nothing else. */
function lesson(name) {
  const root = path.join(tmpRoot, name, 'MATH101', 'claude_lessons', 'sample-lesson');
  fs.mkdirSync(root, { recursive: true });
  const r = run(['init', '--lesson', root, '--mode', 'new', '--session-mode', 'headless',
    '--course', 'MATH101', '--slug', 'sample-lesson']);
  if (r.code !== 0) throw new Error(`init failed: ${r.err}`);
  return { root, runId: r.out, m: (...args) => run([...args, '--lesson', root]) };
}

const record = (l) =>
  JSON.parse(fs.readFileSync(path.join(l.root, '.lesson-builder', 'runs', `${l.runId}.json`), 'utf8'));
const mediaRow = (l, id) => record(l).media.find((m) => m.media_id === id);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const read = (p) => fs.readFileSync(p);
const at = (root, rel) => path.join(root, ...rel.split('/'));

/** A complete 1x1 PNG. Truncating it is what a production killed mid-write leaves behind. */
function png(seed) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, seed & 0xff]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A structurally complete MP4: ftyp + a `bytes`-long mdat whose boxes tile the file exactly. */
function mp4(bytes) {
  const ftyp = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom', 'ascii'), Buffer.alloc(8)]);
  ftyp.writeUInt32BE(ftyp.length, 0);
  const mdat = Buffer.alloc(Math.max(bytes, 16));
  mdat.writeUInt32BE(mdat.length, 0);
  mdat.write('mdat', 4, 'ascii');
  return Buffer.concat([ftyp, mdat]);
}

/** Stubs for the three binaries the manim pipeline shells out to. Nothing real is installed. */
function fakeToolchain(dir, { manimFails } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  // manim: --dry_run exits 0; -s writes the preview still; -qm writes the 720p30 mp4 (a
  // structurally complete one, so the promote step's shape check is a real check).
  const MP4 =
    'const fs=require("fs");' +
    'const f=Buffer.concat([Buffer.alloc(4),Buffer.from("ftypisom"),Buffer.alloc(8)]);' +
    'f.writeUInt32BE(f.length,0);const m=Buffer.alloc(4080);m.writeUInt32BE(m.length,0);' +
    'm.write("mdat",4);fs.writeFileSync(process.argv[1],Buffer.concat([f,m]))';
  write('manim', manimFails
    ? 'echo "stub manim: NameError in scene" 1>&2; exit 1'
    : [
        'case "$1" in',
        '  --version) echo "Manim Community v0.20.1"; exit 0 ;;',
        '  --dry_run) exit 0 ;;',
        '  -ql) mkdir -p media/images/scene; printf PREVIEW > "media/images/scene/$4.png"; exit 0 ;;',
        '  -qm) mkdir -p media/videos/scene/720p30;',
        `       node -e '${MP4}' "media/videos/scene/720p30/$3.mp4"; exit 0 ;;`,
        'esac',
        'exit 0',
      ].join('\n'));
  write('ffprobe', [
    'case "$1" in',
    '  -version) echo "ffprobe stub"; exit 0 ;;',
    'esac',
    'echo \'{"streams":[{"codec_name":"h264","width":1280,"height":720,"duration":"4.000000"}]}\'',
  ].join('\n'));
  // ffmpeg writes whatever path it was handed last (the keyframe PNG).
  write('ffmpeg', [
    'case "$1" in',
    '  -version) echo "ffmpeg stub"; exit 0 ;;',
    'esac',
    'for a in "$@"; do out="$a"; done',
    'printf KEYFRAME > "$out"',
  ].join('\n'));
  return dir;
}

/** Import the ESM pipeline from this CommonJS fixture. */
const pipeline = () => import(`file://${RUNNER}`);

/** Run a body with PATH set to `value`, restoring it afterwards however the body ends. */
async function withPath(value, body) {
  const saved = process.env.PATH;
  process.env.PATH = value;
  try {
    return await body();
  } finally {
    process.env.PATH = saved;
  }
}

// The stubs shell out to `mkdir` and `node`, so they go in FRONT of the real PATH rather than
// replacing it — a manim that happens to be installed on the host still loses to the stub.
const stubbed = (dir) => `${dir}${path.delimiter}${process.env.PATH}`;

const cases = {};

cases['stage prints a path inside the run staging area and writes nothing else'] = () => {
  const l = lesson('stage');
  const p = l.m('stage', '--media-id', 'g1', '--name', 'tangent.png').out;
  eq(path.relative(l.root, p).split(path.sep).join('/'),
    `.lesson-builder/staging/${l.runId}/g1/tangent.png`,
    'the staged path is under .lesson-builder/staging/<run>/<media_id>/');
  ok(fs.existsSync(path.dirname(p)), 'stage created the directory the producer writes into');
  ok(!fs.existsSync(p), 'stage creates the directory, not the file');
  ok(!fs.existsSync(at(l.root, 'public')), 'stage touched nothing in the lesson tree');
  // A traversing id or name would escape the staging area; both are refused before any mkdir.
  ok(l.m('stage', '--media-id', '../../escape', '--name', 'x.png').code === 1,
    'a media id that traverses is refused');
  ok(l.m('stage', '--media-id', 'g1', '--name', '../x.png').code === 1,
    'a file name that traverses is refused');
  ok(!fs.existsSync(path.join(l.root, '.lesson-builder', 'staging', l.runId, '..', 'escape')),
    'and nothing was created outside the staging dir');
};

cases['a validated artifact is promoted and its hash is on the media row'] = () => {
  const l = lesson('promote');
  l.m('append', 'media', JSON.stringify({ media_id: 'g1', intent: 'add', medium: 'matplotlib-ref',
    topic: '3', path: 'public/images/tangent.png', status: 'planned' }));
  const staged = l.m('stage', '--media-id', 'g1', '--name', 'tangent.png').out;
  const bytes = png(7);
  fs.writeFileSync(staged, bytes);

  const r = l.m('promote', '--media-id', 'g1', '--from', staged, '--to', 'public/images/tangent.png');
  eq(r.code, 0, 'a complete PNG promotes');
  const receipt = JSON.parse(r.out);
  eq(receipt.state, 'promoted', 'the receipt says it was promoted');
  eq(receipt.sha256, sha(bytes), 'the receipt carries the SHA-256 of the staged bytes');
  eq(receipt.checked, '.png shape', 'and names the check that passed');

  const dest = at(l.root, 'public/images/tangent.png');
  ok(fs.existsSync(dest), 'the artifact is in the lesson tree');
  eq(sha(read(dest)), sha(bytes), 'byte for byte what was staged');
  const row = mediaRow(l, 'g1');
  eq(row.artifact.sha256, sha(bytes), 'the run record carries the integrity hash');
  eq(row.artifact.bytes, bytes.length, 'and the size');
  eq(row.artifact.path, 'public/images/tangent.png', 'and where it landed');
  eq(row.intent, 'add', "and leaves the plan's intent alone");
  eq(row.status, 'planned', "and the plan's status alone");
  eq(row.artifact_failure, undefined, 'with no failure recorded');
  ok(fs.readdirSync(path.dirname(dest)).every((f) => !f.includes('.part')),
    'no .part file is left behind');
};

cases['a re-run that produces identical bytes changes nothing in the lesson tree'] = () => {
  const l = lesson('idempotent');
  const staged = l.m('stage', '--media-id', 'g1', '--name', 'fig.png').out;
  fs.writeFileSync(staged, png(1));
  l.m('promote', '--media-id', 'g1', '--from', staged, '--to', 'public/images/fig.png');
  const dest = at(l.root, 'public/images/fig.png');
  const before = fs.statSync(dest);
  const firstPromotedAt = mediaRow(l, 'g1').artifact.promoted;

  // The producer runs again and writes the same bytes into a fresh staging file.
  const again = l.m('stage', '--media-id', 'g1', '--name', 'fig.png').out;
  fs.writeFileSync(again, png(1));
  const r = l.m('promote', '--media-id', 'g1', '--from', again, '--to', 'public/images/fig.png',
    '--at', '2026-04-16T00:00:00Z');
  eq(r.code, 0, 'the second promotion succeeds');
  eq(JSON.parse(r.out).state, 'unchanged', 'and reports that nothing changed');
  const after = fs.statSync(dest);
  eq(after.ino, before.ino, 'the file in the lesson tree was not replaced');
  eq(after.mtimeMs, before.mtimeMs, 'and was not rewritten');
  eq(mediaRow(l, 'g1').artifact.promoted, firstPromotedAt,
    'the record keeps the timestamp the bytes first landed at');

  // Different bytes at the same path DO replace the file — the no-op is about the bytes, not the path.
  const changed = l.m('stage', '--media-id', 'g1', '--name', 'fig.png').out;
  fs.writeFileSync(changed, png(2));
  eq(JSON.parse(l.m('promote', '--media-id', 'g1', '--from', changed, '--to', 'public/images/fig.png').out).state,
    'promoted', 'a re-run with different bytes does promote');
  eq(sha(read(dest)), sha(png(2)), 'and the lesson tree holds the new bytes');
};

cases['a production killed mid-write leaves the previous artifact and says why'] = () => {
  const l = lesson('killed');
  const good = png(3);
  const first = l.m('stage', '--media-id', 'v1', '--name', 'plot.png').out;
  fs.writeFileSync(first, good);
  l.m('promote', '--media-id', 'v1', '--from', first, '--to', 'public/images/plot.png');
  const dest = at(l.root, 'public/images/plot.png');
  const before = fs.statSync(dest);
  const goodHash = mediaRow(l, 'v1').artifact.sha256;

  // The re-run is killed part-way through writing its staged PNG: header intact, IEND missing.
  const staged = l.m('stage', '--media-id', 'v1', '--name', 'plot.png').out;
  fs.writeFileSync(staged, png(4).subarray(0, png(4).length - 12));
  const r = l.m('promote', '--media-id', 'v1', '--from', staged, '--to', 'public/images/plot.png');
  eq(r.code, 6, 'the truncated artifact is refused');
  ok(/truncated/.test(r.err), `the refusal says why (${r.err})`);
  ok(/lesson tree is unchanged/.test(r.err), 'and says the lesson tree is unchanged');

  eq(sha(read(dest)), sha(good), 'the previous artifact is still there, byte for byte');
  eq(fs.statSync(dest).ino, before.ino, 'and was never replaced');
  ok(fs.readdirSync(path.dirname(dest)).every((f) => !f.includes('.part')),
    'no partial file is left in the lesson tree at all');
  const row = mediaRow(l, 'v1');
  ok(/truncated/.test(row.artifact_failure.reason), 'the record carries the failure and its reason');
  eq(row.artifact_failure.target, 'public/images/plot.png', 'against the path it was refused for');
  eq(row.artifact.sha256, goodHash, 'and still describes the good artifact the lesson holds');

  // A producer that never got as far as staging a file records the same way, and touches nothing.
  const f = l.m('fail', '--media-id', 'v2', '--reason', 'matplotlib raised: no display');
  eq(f.code, 0, 'fail records a production that produced nothing');
  eq(mediaRow(l, 'v2').artifact_failure.reason, 'matplotlib raised: no display', 'with its reason');
  eq(mediaRow(l, 'v2').artifact, undefined, 'and claims no artifact');
  eq(mediaRow(l, 'v2').intent, null, 'inventing no intent the plan never carried');

  // A later good run clears the failure rather than leaving a stale one beside a good artifact.
  const fixed = l.m('stage', '--media-id', 'v1', '--name', 'plot.png').out;
  fs.writeFileSync(fixed, png(5));
  l.m('promote', '--media-id', 'v1', '--from', fixed, '--to', 'public/images/plot.png');
  eq(mediaRow(l, 'v1').artifact_failure, undefined, 'a later good promotion clears the failure');
};

cases['the lesson tree never holds a partial artifact under its final name'] = () => {
  const l = lesson('atomic');
  const dest = at(l.root, 'public/videos/scene.mp4');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const old = mp4(64);
  fs.writeFileSync(dest, old);
  // A hard link to the same inode: if the promotion wrote through the existing file rather than
  // renaming a complete one over it, the twin would change too.
  const twin = at(l.root, 'public/videos/twin.mp4');
  fs.linkSync(dest, twin);

  const staged = l.m('stage', '--media-id', 'm1', '--name', 'scene.mp4').out;
  const fresh = mp4(4096);
  fs.writeFileSync(staged, fresh);
  eq(l.m('promote', '--media-id', 'm1', '--from', staged, '--to', 'public/videos/scene.mp4').code, 0,
    'the new render promotes');
  eq(sha(read(dest)), sha(fresh), 'the lesson tree holds the new artifact');
  eq(sha(read(twin)), sha(old), 'the old inode was renamed over, never written through');
  ok(fs.statSync(dest).ino !== fs.statSync(twin).ino, 'so the destination is a different inode');

  // Kill the promotion itself while it copies. However the race lands, the final name holds a
  // whole file or nothing — never half of one.
  const big = l.m('stage', '--media-id', 'm2', '--name', 'big.mp4').out;
  const huge = mp4(24 * 1024 * 1024);
  fs.writeFileSync(big, huge);
  const target = at(l.root, 'public/videos/big.mp4');
  const child = spawn(process.execPath,
    [SCRIPT, 'promote', '--lesson', l.root, '--media-id', 'm2', '--from', big, '--to', 'public/videos/big.mp4'],
    { stdio: 'ignore' });
  // Kill it the moment the temp file appears, so the signal lands while the bytes are going down
  // rather than during node's startup.
  const killed = new Promise((resolve) => {
    const poll = setInterval(() => {
      const partial = fs.readdirSync(path.dirname(target)).some((f) => f.includes('.part'));
      if (!partial) return;
      clearInterval(poll);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, 1);
    child.on('exit', () => { clearInterval(poll); resolve(); });
  });
  return killed.then(() => {
    const there = fs.existsSync(target);
    ok(!there || sha(read(target)) === sha(huge),
      'after a kill the final name holds either nothing or the complete artifact');
    const strays = fs.readdirSync(path.dirname(target)).filter((f) => f.includes('.part'));
    ok(strays.every((f) => f.startsWith('.')),
      'a half-written file left by the kill is hidden and cannot be mistaken for the artifact');
    ok(strays.every((f) => f !== 'big.mp4'), 'and never carries the artifact name');
  });
};

cases['an artifact the run did not stage is refused'] = () => {
  const l = lesson('unstaged');
  // A producer that wrote straight into the lesson tree (or anywhere else) gets no promotion.
  const rogue = at(l.root, 'rogue.png');
  fs.writeFileSync(rogue, png(9));
  const r = l.m('promote', '--media-id', 'g1', '--from', rogue, '--to', 'public/images/g1.png');
  eq(r.code, 6, 'a source outside the staging dir is refused');
  ok(/not under this run's staging dir/.test(r.err), `and says so (${r.err})`);
  ok(!fs.existsSync(at(l.root, 'public/images/g1.png')), 'nothing was promoted');

  // Another run's staging dir is not this run's either.
  const other = path.join(l.root, '.lesson-builder', 'staging', 'other1', 'g1');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'g1.png'), png(9));
  eq(l.m('promote', '--media-id', 'g1', '--from', path.join(other, 'g1.png'), '--to', 'public/images/g1.png').code,
    6, "another run's staging dir is refused too");

  const staged = l.m('stage', '--media-id', 'g1', '--name', 'g1.png').out;
  fs.writeFileSync(staged, png(9));
  eq(l.m('promote', '--media-id', 'g1', '--from', staged, '--to', '../../escape.png').code, 6,
    'a destination outside the lesson root is refused');
  eq(l.m('promote', '--media-id', 'g1', '--from', staged, '--to', '.lesson-builder/x.png').code, 6,
    "a destination inside the run's own area is refused");
  fs.mkdirSync(at(l.root, 'public/images/adir.png'), { recursive: true });
  eq(l.m('promote', '--media-id', 'g1', '--from', staged, '--to', 'public/images/adir.png').code, 6,
    'a destination that is already a directory is refused rather than crashing');
  ok(!fs.existsSync(path.resolve(l.root, '..', '..', 'escape.png')), 'and nothing escaped');
  eq(l.m('promote', '--media-id', 'g1', '--from', staged, '--to', 'public/images/g1.png').code, 0,
    'the same bytes staged by this run promote fine');
};

cases['a producer with no run of its own opens one instead of using a finished run'] = () => {
  // A lesson copy with no `.lesson-builder/` at all: cloned, deployed, or built before the run
  // record existed. This is what runtime chat meets (agents/manim-agent.md § File contract).
  const root = path.join(tmpRoot, 'runtime', 'MATH101', 'claude_lessons', 'sample-lesson');
  fs.mkdirSync(root, { recursive: true });
  const bare = run(['stage', '--lesson', root, '--media-id', 'auto_1', '--name', 'auto_1.mp4']);
  ok(bare.code !== 0, 'staging against a lesson with no run record fails rather than inventing one');
  ok(/init/.test(bare.err), `and says to init first (${bare.err})`);
  eq(run(['current', '--lesson', root]).code, 3, 'current reports that the lesson has no run');
  ok(!fs.existsSync(path.join(root, '.lesson-builder', 'staging')),
    'and no staging area was created');

  // A finished build run's record. Nothing later may write into it.
  const build = run(['init', '--lesson', root, '--mode', 'new', '--session-mode', 'headless',
    '--run', 'bbb111', '--at', '2026-04-15T09:00:00Z']).out;
  run(['append', '--lesson', root, '--run', build, 'media',
    JSON.stringify({ media_id: 'm1', intent: 'add', medium: 'manim', status: 'built' })]);
  const buildPath = path.join(root, '.lesson-builder', 'runs', `${build}.json`);
  const buildBefore = fs.readFileSync(buildPath, 'utf8');

  // The runtime render opens its own record and passes that run id to every call.
  const rt = run(['init', '--lesson', root, '--mode', 'update', '--session-mode', 'channel']).out;
  ok(rt && rt !== build, 'init gives the runtime render a run of its own');
  const staged = run(['stage', '--lesson', root, '--run', rt, '--media-id', 'auto_1', '--name', 'auto_1.mp4']).out;
  eq(path.relative(root, staged).split(path.sep).join('/'),
    `.lesson-builder/staging/${rt}/auto_1/auto_1.mp4`, 'staging goes under the runtime run');
  fs.writeFileSync(staged, mp4(4096));
  const r = run(['promote', '--lesson', root, '--run', rt, '--media-id', 'auto_1',
    '--from', staged, '--to', 'public/videos/auto_1.mp4']);
  eq(r.code, 0, 'the runtime render promotes');
  eq(sha(read(at(root, 'public/videos/auto_1.mp4'))), sha(mp4(4096)), 'into the lesson tree');

  const rtRec = JSON.parse(fs.readFileSync(path.join(root, '.lesson-builder', 'runs', `${rt}.json`), 'utf8'));
  eq(rtRec.media.map((m) => m.media_id), ['auto_1'], 'the runtime record carries the artifact');
  eq(rtRec.media[0].artifact.sha256, sha(mp4(4096)), 'with its hash');
  eq(fs.readFileSync(buildPath, 'utf8'), buildBefore,
    "the finished build run's record is byte-identical — a later run never writes into it");
};

cases['each kind is checked for the shape of a complete file'] = () => {
  const l = lesson('kinds');
  const promote = (name, buf, to) => {
    const p = l.m('stage', '--media-id', 'k1', '--name', name).out;
    fs.writeFileSync(p, buf);
    return l.m('promote', '--media-id', 'k1', '--from', p, '--to', to || `public/images/${name}`);
  };
  eq(promote('a.png', Buffer.alloc(0)).code, 6, 'an empty file is refused');
  eq(promote('b.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02])).code, 6,
    'a JPEG with no EOI marker is refused');
  ok(/truncated/.test(promote('c.svg', Buffer.from('<svg><path d="M0 0"')).err),
    'an SVG with no closing tag is refused');
  eq(promote('d.mp4', mp4(4096).subarray(0, 2048), 'public/videos/d.mp4').code, 6,
    'an MP4 whose boxes run past the end is refused');
  eq(promote('e.py', Buffer.from('   \n  \n')).code, 6, 'a source file of only whitespace is refused');
  eq(promote('f.png', png(1)).code, 0, 'a complete PNG passes');
  eq(promote('g.mp4', mp4(4096), 'public/videos/g.mp4').code, 0, 'a complete MP4 passes');
  eq(promote('h.py', Buffer.from('import manim\n')).code, 0, 'a real source file passes');
  eq(JSON.parse(promote('i.bin', Buffer.from('anything')).out).checked,
    'size only (no shape check for .bin)',
    'an extension with no known shape says the bytes were not inspected');
  // --min-bytes is how a caller that knows its artifact is never tiny says so.
  const p = l.m('stage', '--media-id', 'k1', '--name', 'j.png').out;
  fs.writeFileSync(p, png(1));
  eq(l.m('promote', '--media-id', 'k1', '--from', p, '--to', 'public/images/j.png', '--min-bytes', '4096').code,
    6, 'a file under --min-bytes is refused');
  ok(!fs.existsSync(at(l.root, 'public/images/j.png')), 'and is not in the lesson tree');
};

cases['the log renders the artifact hash and the failure reason'] = () => {
  const l = lesson('render');
  l.m('append', 'media', JSON.stringify({ media_id: 'g1', intent: 'add', medium: 'manim', topic: '2' }));
  l.m('append', 'media', JSON.stringify({ media_id: 'g2', intent: 'refine', medium: 'matplotlib-ref' }));
  const staged = l.m('stage', '--media-id', 'g1', '--name', 'scene.mp4').out;
  fs.writeFileSync(staged, mp4(4096));
  l.m('promote', '--media-id', 'g1', '--from', staged, '--to', 'public/videos/scene.mp4');
  l.m('fail', '--media-id', 'g2', '--reason', 'render timed out after 300000ms');
  eq(l.m('render').code, 0, 'render succeeds');
  const log = fs.readFileSync(path.join(l.root, 'lesson_build.log.md'), 'utf8');
  ok(log.includes(`sha256:${sha(mp4(4096)).slice(0, 12)}`), 'the log carries the artifact hash');
  ok(log.includes('public/videos/scene.mp4'), 'and where it landed');
  ok(log.includes('PRODUCTION FAILED: render timed out after 300000ms'),
    'and the failed production with its reason');
  const again = (() => { l.m('render'); return fs.readFileSync(path.join(l.root, 'lesson_build.log.md'), 'utf8'); })();
  eq(again, log, 'rendering twice is byte-identical');
};

cases['the manim pipeline stages, validates and promotes with no manim installed'] = async () => {
  const l = lesson('manim');
  const bin = fakeToolchain(path.join(tmpRoot, 'manim', 'bin'));
  const scratchBefore = fs.existsSync(SCRATCH) ? fs.readdirSync(SCRATCH) : [];
  const { checkDependencies, runManimPipeline } = await pipeline();

  await withPath('/nonexistent', async () => {
    const deps = await checkDependencies();
    eq(deps, { manim: false, ffmpeg: false, ffprobe: false },
      'checkDependencies reports all three missing without throwing');
    // Nothing installed: the pipeline still returns rather than throwing, and writes no target.
    const target = at(l.root, 'public/videos/absent.mp4');
    const r = await runManimPipeline({ sceneSource: 'from manim import *\n', sceneName: 'S', targetMp4Path: target });
    eq(r.ok, false, 'a missing manim is a returned failure, never a throw');
    ok(/spawn|ENOENT|dry-run/.test(r.reason || ''), `with a reason (${r.reason})`);
    ok(!fs.existsSync(target), 'and no file at the target path');
  });

  await withPath(stubbed(bin), async () => {
    const deps = await checkDependencies();
    eq(deps, { manim: true, ffmpeg: true, ffprobe: true }, 'checkDependencies finds the stubs');

    // Guards still come back as reasons, not exceptions.
    for (const [args, what] of [
      [{ sceneSource: '', sceneName: 'S', targetMp4Path: 'x.mp4' }, 'an empty scene source'],
      [{ sceneSource: 'x', sceneName: '2bad', targetMp4Path: 'x.mp4' }, 'an invalid scene name'],
      [{ sceneSource: 'x', sceneName: 'S', targetMp4Path: '' }, 'a missing target path'],
    ]) {
      const r = await runManimPipeline(args);
      ok(r.ok === false && typeof r.reason === 'string', `${what} returns { ok: false, reason }`);
    }

    // The real thing: render into the run staging area, then promote from there.
    const staged = l.m('stage', '--media-id', 'm1', '--name', 'tangent.mp4').out;
    const r = await runManimPipeline({ sceneSource: 'from manim import *\n', sceneName: 'Tangent', targetMp4Path: staged });
    eq(r.ok, true, `the five stages run against the stubs (${r.reason || ''})`);
    eq(r.mp4Path, staged, 'the mp4 lands at the staging path it was given');
    eq(r.durationSec, 4, 'the ffprobe duration comes back');
    ok(r.previewPngPath && fs.existsSync(r.previewPngPath), 'the preview still was captured');
    eq((r.keyframePaths || []).length, 3, 'three keyframes were extracted');
    ok((r.keyframePaths || []).every((p) => fs.existsSync(p)), 'and all three exist');
    ok(!fs.existsSync(at(l.root, 'public/videos/tangent.mp4')),
      'the render alone puts nothing in the lesson tree');

    const receipt = JSON.parse(
      l.m('promote', '--media-id', 'm1', '--from', staged, '--to', 'public/videos/tangent.mp4').out);
    eq(receipt.state, 'promoted', 'the promote step moves it into the lesson tree');
    eq(receipt.sha256, sha(read(staged)), 'under the hash of the bytes that were validated');
    eq(mediaRow(l, 'm1').artifact.path, 'public/videos/tangent.mp4', 'and the record says where');

    // A failed re-render leaves the promoted video exactly as it was.
    const failing = fakeToolchain(path.join(tmpRoot, 'manim', 'failbin'), { manimFails: true });
    const promoted = at(l.root, 'public/videos/tangent.mp4');
    const before = fs.statSync(promoted);
    await withPath(stubbed(failing), async () => {
      const again = l.m('stage', '--media-id', 'm1', '--name', 'tangent.mp4').out;
      const bad = await runManimPipeline({ sceneSource: 'from manim import *\n', sceneName: 'Tangent', targetMp4Path: again });
      eq(bad.ok, false, 'a scene that will not render fails');
      ok(/dry-run failed/.test(bad.reason || ''), `at the dry run, with its reason (${bad.reason})`);
      l.m('fail', '--media-id', 'm1', '--reason', `manim: ${String(bad.reason).slice(0, 40)}`);
    });
    eq(fs.statSync(promoted).ino, before.ino, 'the promoted video is untouched');
    eq(sha(read(promoted)), receipt.sha256, 'and still the bytes the record names');
    ok(/manim: dry-run failed/.test(mediaRow(l, 'm1').artifact_failure.reason),
      'while the record carries the failure');
  });
  for (const entry of fs.readdirSync(SCRATCH)) {
    if (!scratchBefore.includes(entry)) fs.rmSync(path.join(SCRATCH, entry), { recursive: true, force: true });
  }
};

(async () => {
  process.stdout.write(`stage-promote fixture (${SCRIPT})\n`);
  for (const [name, fn] of Object.entries(cases)) {
    process.stdout.write(`- ${name}\n`);
    try {
      await fn();
    } catch (e) {
      failures++;
      process.stdout.write(`  FAIL threw: ${e.message}\n`);
    }
  }

  if (process.env.KEEP) process.stdout.write(`\nkept: ${tmpRoot}\n`);
  else fs.rmSync(tmpRoot, { recursive: true, force: true });

  process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
  process.exit(failures ? 1 : 0);
})();
