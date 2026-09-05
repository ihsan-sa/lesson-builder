#!/usr/bin/env node
/**
 * run-manifest — the lesson-builder run record: write it, read it, render the log from it.
 *
 * One versioned JSON record per run at
 *   <lesson_root>/.lesson-builder/runs/<run_id>.json          (schema "lesson-run/1")
 * and `lesson_build.log.md` rendered from every record in the lesson, below a marker line.
 * Text above the marker (a log written before records existed) is copied through byte for byte.
 *
 * The record is the state. No phase reads a field back out of the markdown.
 * Schema and field-by-field ownership: references/run-record.md.
 *
 * Usage:
 *   run-manifest.cjs init     --lesson <dir> --mode new|update|consolidate
 *                             --session-mode interactive|channel|headless
 *                             [--run <id>] [--course <c>] [--slug <s>] [--at <iso>]
 *   run-manifest.cjs current  --lesson <dir>                      # newest run_id
 *   run-manifest.cjs get      --lesson <dir> [--run <id>] <path>
 *   run-manifest.cjs set      --lesson <dir> [--run <id>] <path> <value> [--json]
 *   run-manifest.cjs append   --lesson <dir> [--run <id>] <path> <json>
 *   run-manifest.cjs plan-hash --lesson <dir> [--run <id>] --file <plan.md>
 *   run-manifest.cjs approve  --lesson <dir> [--run <id>] --hash <h> [--at <iso>]
 *   run-manifest.cjs stage    --lesson <dir> [--run <id>] --media-id <id> --name <file>
 *   run-manifest.cjs promote  --lesson <dir> [--run <id>] --media-id <id> --from <staged path>
 *                             --to <lesson-relative path> [--min-bytes <n>] [--at <iso>]
 *   run-manifest.cjs fail     --lesson <dir> [--run <id>] --media-id <id> --reason <text>
 *   run-manifest.cjs render   --lesson <dir>
 *
 * `--run` defaults to the newest record in the lesson. Dotted <path>s index into the record
 * (`git.base_sha`, `plan.approval.state`, `phases.3.notes`).
 *
 * Stage, validate, promote: a producer writes only into the run staging area
 * (`.lesson-builder/staging/<run_id>/<media_id>/`, printed by `stage`), and an artifact enters the
 * lesson tree only through `promote`, which refuses anything this run did not stage, checks the
 * staged bytes are a complete file of their kind, and lands them by write-to-`.part`-then-rename so
 * the final name never holds a partial file. `promote` records the artifact's SHA-256 on its
 * `media` row; a refusal and `fail` record the reason there and leave the lesson tree untouched.
 * Identical bytes already in place are left alone entirely.
 *
 * Exit codes:
 *   0  ok
 *   1  usage or I/O error
 *   2  init: a record with that run_id already exists (never clobbered)
 *   3  get: the field is unset (absent or null)  |  approve: hash does not match the recorded plan
 *   4  approve: no plan is recorded for this run — approval refers to nothing, so it is not approval
 *   5  approve: the run was aborted by a person; a machine does not un-abort it
 *   6  promote: refused — not staged by this run, not a complete file, or the write failed; the
 *      lesson tree is unchanged and the reason is on the media row
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'lesson-run/1';
// The deploy triple is a scoping answer, but the log has always shown it under Phase 5 — where the
// deploy actually happened — so it renders there and is left out of the Phase 0 scoping dump.
// A later update reads it back from the previous run's record; nothing parses it out of the log.
const DEPLOY_KEYS = [
  ['deploy_action', 'Deploy action'],
  ['deploy_service_kind', 'Deploy service kind'],
  ['deploy_service', 'Deploy service'],
];
const MARKER =
  '<!-- lesson-builder:rendered v1 — everything below is generated from ' +
  '.lesson-builder/runs/ by scripts/run-manifest.cjs; edit the record, not this file -->';

function die(msg, code) {
  process.stderr.write(`run-manifest: ${msg}\n`);
  process.exit(code === undefined ? 1 : code);
}

// ---------- argv ----------

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined) die(`flag --${key} needs a value`);
      flags[key] = val;
    } else positional.push(a);
  }
  return { flags, positional };
}

// ---------- record I/O ----------

const runsDir = (lessonRoot) => path.join(lessonRoot, '.lesson-builder', 'runs');
const recordPath = (lessonRoot, runId) => path.join(runsDir(lessonRoot), `${runId}.json`);

function listRecords(lessonRoot) {
  const dir = runsDir(lessonRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readRecord(lessonRoot, f.slice(0, -5)))
    // Newest last. `started` is an ISO string, so lexical order is chronological; equal
    // stamps (two runs inside the same second) tie-break on run_id so the order is total.
    .sort((a, b) =>
      a.started === b.started
        ? a.run_id < b.run_id
          ? -1
          : 1
        : a.started < b.started
          ? -1
          : 1,
    );
}

function readRecord(lessonRoot, runId) {
  const p = recordPath(lessonRoot, runId);
  if (!fs.existsSync(p)) die(`no record at ${p}`);
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    die(`record ${p} is not valid JSON: ${e.message}`);
  }
  if (rec.schema !== SCHEMA) die(`record ${p} has schema ${rec.schema}, expected ${SCHEMA}`);
  return rec;
}

function writeRecord(lessonRoot, rec) {
  const dir = runsDir(lessonRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(recordPath(lessonRoot, rec.run_id), `${JSON.stringify(rec, null, 2)}\n`);
}

function resolveRun(lessonRoot, flags) {
  if (flags.run) return flags.run;
  const all = listRecords(lessonRoot);
  if (!all.length) die(`no run records under ${runsDir(lessonRoot)} — run \`init\` first`);
  return all[all.length - 1].run_id;
}

// ---------- dotted paths ----------

function getPath(obj, dotted) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] === null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

// ---------- the plan hash ----------

// SKILL.md § Session modes and gates: "the first 8 hex characters of the SHA-256 of the exact
// artifact text". Hash the file's bytes as they are — no trimming, no normalising — so the
// hash the gate quotes is reproducible with `sha256sum <plan file> | cut -c1-8`.
function planHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

// An approval quotes 8 hex characters. Compare all 8, case-folded: a prefix of the recorded
// hash is not the recorded hash, and anything that is not 8 hex characters cannot match one.
function normalizeHash(h) {
  const s = String(h).trim().toLowerCase();
  return /^[0-9a-f]{8}$/.test(s) ? s : null;
}

// ---------- commands ----------

function cmdInit(flags) {
  const lessonRoot = requireLesson(flags);
  const at = flags.at || new Date().toISOString();
  const mode = flags.mode;
  if (!['new', 'update', 'consolidate'].includes(mode))
    die('--mode must be new, update or consolidate');
  const sessionMode = flags['session-mode'];
  if (!['interactive', 'channel', 'headless'].includes(sessionMode))
    die('--session-mode must be interactive, channel or headless');

  const runId =
    flags.run ||
    crypto.createHash('sha256').update(`${at}:${lessonRoot}:${Math.random()}`).digest('hex').slice(0, 6);
  if (fs.existsSync(recordPath(lessonRoot, runId)))
    die(`a record for run ${runId} already exists — records are never clobbered`, 2);

  writeRecord(lessonRoot, {
    schema: SCHEMA,
    run_id: runId,
    started: at,
    ended: null,
    mode,
    session_mode: sessionMode,
    effort_mode: null,
    lesson: {
      course: flags.course || path.basename(path.resolve(lessonRoot, '..', '..')),
      slug: flags.slug || path.basename(path.resolve(lessonRoot)),
      lesson_file: null,
    },
    scoping: {},
    plan: { hash: null, artifact: null, approval: { state: 'none', at: null, via: null } },
    git: {
      branch: null,
      base_sha: null,
      stash_oid: null,
      stash_ref: null,
      stash_branch: null,
      commit_sha: null,
      stash_recovery: null,
    },
    media: [],
    findings: [],
    phases: {},
  });
  process.stdout.write(`${runId}\n`);
}

function cmdCurrent(flags) {
  const all = listRecords(requireLesson(flags));
  if (!all.length) die('no run records', 3);
  process.stdout.write(`${all[all.length - 1].run_id}\n`);
}

function cmdGet(flags, positional) {
  const lessonRoot = requireLesson(flags);
  const dotted = positional[0];
  if (!dotted) die('get needs a dotted field path');
  const value = getPath(readRecord(lessonRoot, resolveRun(lessonRoot, flags)), dotted);
  // `init` seeds the fields it does not know yet as null, so null means "this run has none" —
  // the same answer as a path that is not in the record at all, and never the string "null".
  if (value === undefined || value === null) die(`no value for ${dotted} in the record`, 3);
  process.stdout.write(
    `${typeof value === 'string' ? value : JSON.stringify(value)}\n`,
  );
}

function cmdSet(flags, positional) {
  const lessonRoot = requireLesson(flags);
  const [dotted, raw] = positional;
  if (!dotted || raw === undefined) die('set needs a dotted field path and a value');
  const rec = readRecord(lessonRoot, resolveRun(lessonRoot, flags));
  let value = raw;
  if (flags.json) {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      die(`--json given but the value is not JSON: ${e.message}`);
    }
  }
  setPath(rec, dotted, value);
  writeRecord(lessonRoot, rec);
}

function cmdAppend(flags, positional) {
  const lessonRoot = requireLesson(flags);
  const [dotted, raw] = positional;
  if (!dotted || raw === undefined) die('append needs a dotted field path and a JSON value');
  const rec = readRecord(lessonRoot, resolveRun(lessonRoot, flags));
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    die(`append takes JSON: ${e.message}`);
  }
  const existing = getPath(rec, dotted);
  if (existing !== undefined && !Array.isArray(existing)) die(`${dotted} is not an array`);
  setPath(rec, dotted, (existing || []).concat([value]));
  writeRecord(lessonRoot, rec);
}

function cmdPlanHash(flags) {
  const lessonRoot = requireLesson(flags);
  if (!flags.file) die('plan-hash needs --file <plan artifact>');
  if (!fs.existsSync(flags.file)) die(`no plan artifact at ${flags.file}`);
  const rec = readRecord(lessonRoot, resolveRun(lessonRoot, flags));
  const hash = planHash(fs.readFileSync(flags.file));
  const changed = rec.plan.hash !== null && rec.plan.hash !== hash;
  rec.plan.hash = hash;
  rec.plan.artifact = path.relative(lessonRoot, path.resolve(flags.file)) || flags.file;
  // "a revised plan is a different plan, and the point of the hash is that approval cannot
  // silently transfer to text the user never saw" — so a revision re-enters the gate as pending,
  // including one made after the plan was approved. An abort is not undone by editing the plan,
  // and `approve` remains the only writer of an approval.
  if (rec.plan.approval.state === 'none' || (changed && rec.plan.approval.state !== 'aborted'))
    rec.plan.approval = { state: 'pending', at: null, via: null };
  writeRecord(lessonRoot, rec);
  process.stdout.write(`${hash}\n`);
}

function cmdApprove(flags) {
  const lessonRoot = requireLesson(flags);
  if (!flags.hash) die('approve needs --hash <hash from the task text>');
  const rec = readRecord(lessonRoot, resolveRun(lessonRoot, flags));

  // "the approved-but-nothing-recorded case": the task text carries an approval but this run
  // recorded no plan. The approval refers to nothing, so it is not approval — Phase 2 re-emits.
  if (!rec.plan.hash) {
    process.stderr.write(
      `run-manifest: run ${rec.run_id} has no recorded plan; ` +
        `APPROVED PLAN ${flags.hash} refers to nothing. Re-run Phase 2 and re-emit the gate.\n`,
    );
    process.exit(4);
  }
  if (rec.plan.approval.state === 'aborted') {
    process.stderr.write(`run-manifest: run ${rec.run_id} was aborted at ${rec.plan.approval.at}\n`);
    process.exit(5);
  }

  const given = normalizeHash(flags.hash);
  const recorded = normalizeHash(rec.plan.hash);
  if (given === null || recorded === null || given !== recorded) {
    process.stderr.write(
      `run-manifest: offered ${flags.hash}, recorded plan is ${rec.plan.hash} — not approval. ` +
        `Re-emit the current plan under its hash and block again.\n`,
    );
    process.exit(3);
  }

  // Already approved at this hash: report it, keep the timestamp the person's approval got.
  if (rec.plan.approval.state !== 'approved') {
    rec.plan.approval = {
      state: 'approved',
      at: flags.at || new Date().toISOString(),
      via: `APPROVED PLAN ${recorded}`,
    };
    writeRecord(lessonRoot, rec);
  }
  process.stdout.write(`approved ${recorded} at ${rec.plan.approval.at}\n`);
}

// ---------- artifacts: stage, validate, promote ----------

// The run staging area. Every producer writes its output here and nowhere else; an artifact
// reaches the lesson tree only through `promote`, which validates the staged bytes first. It sits
// beside the run records, so the lesson's own `.gitignore` (`.lesson-builder/`) already covers it.
// Text the assembly splices into the lesson source stages in `.build-scratch/` instead — same rule,
// different home (references/phase-3-execution.md § The run staging area).
const stagingDir = (lessonRoot, runId, mediaId) =>
  path.join(lessonRoot, '.lesson-builder', 'staging', runId, mediaId);

// A media id and a file name each become one path segment, so neither may traverse or be empty.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requireSegment(value, what) {
  if (!value) die(`${what} is required`);
  if (!SEGMENT.test(value) || value.includes('..'))
    die(`${what} "${value}" is not a plain path segment`);
  return value;
}

// `child` is strictly inside `parent` — used to keep a promotion's source inside the staging area
// and its destination inside the lesson.
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));

function bytesAt(buf, bytes, offset) {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function bytesAtEnd(buf, bytes) {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[buf.length - bytes.length + i] === b);
}

function utf8Text(buf) {
  const s = buf.toString('utf8');
  if (Buffer.compare(Buffer.from(s, 'utf8'), buf) !== 0) return 'not valid UTF-8 text';
  if (!s.trim()) return 'the file is only whitespace';
  return null;
}

// Every top-level MP4 box declares its own length, so a complete file's boxes tile it exactly. A
// render killed part-way through `mdat` leaves a last box that runs past the end — the only cheap
// way to catch a truncated MP4 with no ffprobe on the host.
function mp4Complete(buf) {
  if (!bytesAt(buf, ascii('ftyp'), 4)) return 'not an MP4 (no ftyp box at offset 4)';
  let at = 0;
  while (at < buf.length) {
    if (at + 8 > buf.length) return `MP4 is truncated (box header at ${at} runs past the end)`;
    let size = buf.readUInt32BE(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > buf.length) return `MP4 is truncated (64-bit box header at ${at} runs past the end)`;
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) {
      return null; // size 0 means "to the end of the file", legal only for the last box
    }
    if (size < header) return `MP4 is malformed (box at ${at} declares a ${size}-byte length)`;
    if (at + size > buf.length)
      return `MP4 is truncated (box at ${at} declares ${size} bytes, ${buf.length - at} remain)`;
    at += size;
  }
  return at === buf.length ? null : `MP4 is malformed (boxes end at ${at}, file is ${buf.length} bytes)`;
}

const jpeg = (b) =>
  !bytesAt(b, [0xff, 0xd8, 0xff], 0)
    ? 'not a JPEG (bad SOI marker)'
    : !bytesAtEnd(b, [0xff, 0xd9])
      ? 'JPEG is truncated (no EOI marker at the end)'
      : null;

const svg = (b) => {
  const bad = utf8Text(b);
  if (bad) return bad;
  const s = b.toString('utf8');
  if (!s.includes('<svg')) return 'not an SVG (no <svg element)';
  return /<\/svg>\s*$/.test(s) ? null : 'SVG is truncated (no closing </svg>)';
};

// What a complete file of each kind looks like on disk. A production killed mid-write leaves a
// plausible header and a missing tail, so every kind that has a fixed trailer is checked at both
// ends — that, not the size, is what catches a truncated PNG or a half-downloaded JPEG.
const VALIDATORS = {
  '.png': (b) =>
    !bytesAt(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
      ? 'not a PNG (bad 8-byte signature)'
      : !bytesAtEnd(b, ascii('IEND').concat([0xae, 0x42, 0x60, 0x82]))
        ? 'PNG is truncated (no IEND chunk at the end)'
        : null,
  '.jpg': jpeg,
  '.jpeg': jpeg,
  '.gif': (b) =>
    !bytesAt(b, ascii('GIF8'), 0)
      ? 'not a GIF (bad header)'
      : !bytesAtEnd(b, [0x3b])
        ? 'GIF is truncated (no trailer byte)'
        : null,
  '.webp': (b) =>
    !bytesAt(b, ascii('RIFF'), 0) || !bytesAt(b, ascii('WEBP'), 8)
      ? 'not a WebP (bad RIFF header)'
      : b.readUInt32LE(4) !== b.length - 8
        ? `WebP is truncated (RIFF declares ${b.readUInt32LE(4) + 8} bytes, file is ${b.length})`
        : null,
  '.mp4': mp4Complete,
  '.webm': (b) =>
    bytesAt(b, [0x1a, 0x45, 0xdf, 0xa3], 0) ? null : 'not a Matroska/WebM stream (bad EBML header)',
  '.svg': svg,
  '.py': utf8Text,
  '.jsx': utf8Text,
  '.js': utf8Text,
  '.json': utf8Text,
  '.md': utf8Text,
  '.txt': utf8Text,
  '.b64': utf8Text,
};

// Returns { reason } to refuse, or { checked } naming the check that passed.
function validateArtifact(buf, dest, minBytes) {
  if (buf.length === 0) return { reason: 'the staged file is empty' };
  if (buf.length < minBytes)
    return { reason: `the staged file is ${buf.length} bytes, under --min-bytes ${minBytes}` };
  const ext = path.extname(dest).toLowerCase();
  const validator = VALIDATORS[ext];
  // An extension with no known shape still gets the size checks, and the receipt says so rather
  // than implying the bytes were inspected.
  if (!validator) return { checked: `size only (no shape check for ${ext || 'an extensionless file'})` };
  const bad = validator(buf);
  return bad ? { reason: bad } : { checked: `${ext} shape` };
}

function mediaRow(rec, mediaId) {
  let row = rec.media.find((m) => m && m.media_id === mediaId);
  if (!row) {
    // An artifact for an id the plan does not carry (a runtime-chat render, a degraded refine).
    // Record it rather than drop it — and invent no `intent`: that word is the plan's, and a
    // machine does not write one the plan never said.
    row = { media_id: mediaId, intent: null, medium: null, topic: null, path: null, status: null };
    rec.media.push(row);
  }
  return row;
}

// A failed production leaves the previous artifacts untouched on disk, so the row's `artifacts`
// (what the lesson tree actually holds) are left exactly as they were and the failure is recorded
// beside them, never over them.
function recordFailure(lessonRoot, rec, mediaId, target, reason, at) {
  mediaRow(rec, mediaId).artifact_failure = {
    target: target || null,
    reason,
    at: at || new Date().toISOString(),
  };
  writeRecord(lessonRoot, rec);
}

function cmdStage(flags) {
  const lessonRoot = requireLesson(flags);
  const runId = resolveRun(lessonRoot, flags);
  readRecord(lessonRoot, runId); // nothing stages against a run that has no record
  const mediaId = requireSegment(flags['media-id'], '--media-id');
  const name = requireSegment(flags.name, '--name');
  const dir = stagingDir(lessonRoot, runId, mediaId);
  fs.mkdirSync(dir, { recursive: true });
  process.stdout.write(`${path.join(dir, name)}\n`);
}

function cmdPromote(flags) {
  const lessonRoot = requireLesson(flags);
  const runId = resolveRun(lessonRoot, flags);
  const rec = readRecord(lessonRoot, runId);
  const mediaId = requireSegment(flags['media-id'], '--media-id');
  if (!flags.from) die("promote needs --from <a path under this run's staging dir>");
  if (!flags.to) die('promote needs --to <a path relative to the lesson root>');
  const minBytes = flags['min-bytes'] === undefined ? 1 : Number(flags['min-bytes']);
  if (!Number.isInteger(minBytes) || minBytes < 1) die('--min-bytes must be a positive integer');

  const stage = stagingDir(lessonRoot, runId, mediaId);
  const from = path.resolve(flags.from);
  const dest = path.resolve(lessonRoot, flags.to);
  const rel = path.relative(path.resolve(lessonRoot), dest).split(path.sep).join('/');

  // Every refusal takes this exit: the reason is recorded against the media id and the lesson tree
  // is left holding whatever it already had.
  const refuse = (reason) => {
    recordFailure(lessonRoot, rec, mediaId, flags.to, reason, flags.at);
    process.stderr.write(
      `run-manifest: ${mediaId} not promoted to ${flags.to}: ${reason}. The lesson tree is unchanged.\n`,
    );
    process.exit(6);
  };

  if (path.isAbsolute(flags.to) || !isInside(lessonRoot, dest))
    refuse(`--to ${flags.to} is outside the lesson root`);
  if (rel.split('/')[0] === '.lesson-builder')
    refuse(`--to ${flags.to} is inside the run's own area, not the lesson tree`);
  if (fs.existsSync(dest) && !fs.statSync(dest).isFile())
    refuse(`--to ${flags.to} already exists and is not a regular file`);
  // The rule with teeth: an artifact this run did not stage is an artifact nothing validated.
  if (!isInside(stage, from))
    refuse(
      `--from ${flags.from} is not under this run's staging dir ` +
        `(${path.relative(path.resolve(lessonRoot), stage).split(path.sep).join('/')})`,
    );

  let stat = null;
  try {
    stat = fs.statSync(from);
  } catch {
    refuse(`nothing staged at ${flags.from}`);
  }
  if (!stat.isFile()) refuse(`${flags.from} is not a regular file`);

  let buf = null;
  try {
    buf = fs.readFileSync(from);
  } catch (e) {
    refuse(`the staged file cannot be read: ${e.message}`);
  }

  const verdict = validateArtifact(buf, dest, minBytes);
  if (verdict.reason) refuse(verdict.reason);

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const at = flags.at || new Date().toISOString();
  const row = mediaRow(rec, mediaId);
  const destSha = fs.existsSync(dest)
    ? crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')
    : null;

  // A re-run that produced identical bytes leaves the file completely alone — no rewrite, no new
  // mtime, nothing for a watcher or a git status to see.
  let state = 'unchanged';
  if (destSha !== sha256) {
    state = 'promoted';
    // Write under a name the lesson never reads, then rename. The final name only ever appears
    // with the whole artifact behind it, so a kill mid-write leaves the previous file intact and
    // the half-written bytes under a dotted `.part` name nothing serves.
    const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${runId}.part`);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, buf);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, dest);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
      refuse(`the promotion itself failed: ${e.message}`);
    }
  }

  // The plan's `path` is the plan's word and is left alone; where the bytes actually landed is
  // `artifacts[].path`, so a disagreement between the two stays visible. One entry per destination
  // path, merged by path on a re-promotion: a media id that promotes several files — a manim video
  // and the `.py` that reproduces it — keeps a hash for each, rather than the second promotion
  // overwriting the first.
  if (!Array.isArray(row.artifacts)) row.artifacts = [];
  const seen = row.artifacts.findIndex((a) => a && a.path === rel);
  const prior = seen === -1 ? null : row.artifacts[seen];
  const entry = {
    path: rel,
    sha256,
    bytes: buf.length,
    // Identical bytes already recorded keep the timestamp they first landed at — a no-op re-run
    // moves nothing at all.
    promoted: state === 'unchanged' && prior && prior.sha256 === sha256 ? prior.promoted : at,
    state,
  };
  if (seen === -1) row.artifacts.push(entry);
  else row.artifacts[seen] = entry;
  delete row.artifact_failure; // this id holds a validated artifact again
  writeRecord(lessonRoot, rec);
  process.stdout.write(
    `${JSON.stringify({ media_id: mediaId, path: rel, sha256, bytes: buf.length, state, checked: verdict.checked })}\n`,
  );
}

function cmdFail(flags) {
  const lessonRoot = requireLesson(flags);
  const runId = resolveRun(lessonRoot, flags);
  const rec = readRecord(lessonRoot, runId);
  const mediaId = requireSegment(flags['media-id'], '--media-id');
  if (!flags.reason) die('fail needs --reason "<why the production produced no artifact>"');
  // No target: nothing got far enough to have one. `promote`'s refusals carry the path they were
  // refused for; this one carries only the reason.
  recordFailure(lessonRoot, rec, mediaId, null, flags.reason, flags.at);
  process.stdout.write(`recorded: ${mediaId} failed — ${flags.reason}\n`);
}

// ---------- render ----------

function notes(rec, phase) {
  const p = rec.phases && rec.phases[String(phase)];
  const list = p && Array.isArray(p.notes) ? p.notes : [];
  return list.map((n) => `${n}`);
}

function line(label, value) {
  return value === null || value === undefined || value === '' ? [] : [`${label}: ${value}`];
}

function renderApproval(rec) {
  const a = rec.plan.approval;
  const h = rec.plan.hash ? ` (hash ${rec.plan.hash})` : '';
  if (a.state === 'approved') return `Approval: APPROVED${a.via ? ` via ${a.via}` : ' by user'} at ${a.at}`;
  if (a.state === 'aborted') return `Approval: ABORTED by user at ${a.at}`;
  // `via` carries the CONSOLIDATION plan's hash. `plan.hash` is this lesson's own plan and is null
  // for a per-lesson consolidate run that never hashed an artifact of its own.
  if (a.state === 'inherited') return `Approval: INHERITED from consolidation plan ${a.via} at ${a.at}`;
  if (a.state === 'pending') return `Approval: PENDING${h}`;
  return `Approval: none recorded${h}`;
}

function renderMedia(rec) {
  if (!rec.media.length) return [];
  return ['Media:'].concat(
    rec.media.map((m) => {
      const a = Array.isArray(m.artifacts) ? m.artifacts : [];
      const f = m.artifact_failure;
      return (
        `  - ${m.media_id || '<no id>'} — intent: ${m.intent || 'unspecified'}` +
        `${m.medium ? ` — ${m.medium}` : ''}${m.original_intent ? ` — original intent: ${m.original_intent}` : ''}` +
        `${m.status ? ` — ${m.status}` : ''}` +
        // What the lesson tree holds — one segment per promoted path — and why the last
        // production did not change it.
        a
          .map((x) => ` — ${x.path} sha256:${String(x.sha256).slice(0, 12)} (${x.bytes} bytes, ${x.state})`)
          .join('') +
        `${f ? ` — PRODUCTION FAILED: ${f.reason}` : ''}`
      );
    }),
  );
}

function renderFindings(rec) {
  const open = rec.findings.filter((f) => f.state !== 'resolved');
  if (!open.length) return ['- (none)'];
  return open.map(
    (f) =>
      `- ${f.summary || f.id || '<unnamed finding>'}` +
      `${f.origin ? ` — origin: ${f.origin}` : ''}${f.reason ? ` — ${f.reason}` : ''}`,
  );
}

function renderRun(rec) {
  const update = rec.mode !== 'new';
  const h2 = update ? '###' : '##';
  const suffix = update ? ' (update)' : '';
  const out = [];

  if (update) out.push(`## Update ${rec.started.slice(0, 10)} (run-id: ${rec.run_id})`, '');
  else out.push(`## Run ${rec.run_id} — started ${rec.started}`, '');

  out.push(`${h2} Phase 0 — Scoping${suffix}`);
  out.push(
    ...line('Detected mode', rec.mode),
    ...line('Session mode', rec.session_mode),
    ...line('Effort mode', rec.effort_mode),
    ...line('Lesson file', rec.lesson.lesson_file),
    // A stash has a ref to report; a tree the user discarded has none, so Phase 0 records the word
    // it chose in `scoping.working_tree` and that word is what renders. "clean" is only the answer
    // when neither is set — never a stand-in for a state a person actually decided.
    ...line(
      'Working tree state',
      rec.git.stash_oid
        ? `stashed: ${rec.git.stash_ref || 'stash@{0}'} (${rec.git.stash_oid})` +
            `${rec.git.stash_branch ? ` on ${rec.git.stash_branch}` : ''}`
        : rec.scoping.working_tree || 'clean',
    ),
    ...Object.keys(rec.scoping)
      .filter((k) => k !== 'working_tree' && !DEPLOY_KEYS.some(([key]) => key === k))
      .map(
        (k) =>
          `${k}: ${typeof rec.scoping[k] === 'string' ? rec.scoping[k] : JSON.stringify(rec.scoping[k])}`,
      ),
    ...notes(rec, 0),
    '',
  );

  out.push(`${h2} Phase 1 — Content Analysis${suffix}`, ...notes(rec, 1), '');

  out.push(`${h2} Phase 2 — Plan${suffix}`);
  out.push(
    ...line('Plan artifact', rec.plan.artifact),
    ...line('Plan hash', rec.plan.hash),
    renderApproval(rec),
    ...renderMedia(rec),
    ...notes(rec, 2),
    '',
  );

  out.push(`${h2} Phase 3 — Execution${suffix}`);
  out.push(
    ...line('Branch', rec.git.branch),
    ...line('Base SHA', rec.git.base_sha),
    ...line(
      'Stash ref',
      rec.git.stash_oid ? `${rec.git.stash_ref || 'stash@{0}'} (${rec.git.stash_oid})` : 'none',
    ),
    ...notes(rec, 3),
    '',
  );

  out.push(`${h2} Phase 4 — Review${suffix}`, ...notes(rec, 4), '');
  out.push(update ? '#### UNRESOLVED' : '### UNRESOLVED', ...renderFindings(rec), '');

  out.push(`${h2} Phase 5 — Deploy${suffix}`);
  out.push(
    ...DEPLOY_KEYS.flatMap(([key, label]) => line(label, rec.scoping[key])),
    ...line('Commit SHA', rec.git.commit_sha),
    ...line('Stash recovery', rec.git.stash_recovery),
    ...notes(rec, 5),
    ...line('Ended', rec.ended),
    '',
  );

  out.push(update ? '#### Final Report' : '## Final Report to User', ...renderFindings(rec), '');
  return out.join('\n');
}

function cmdRender(flags) {
  const lessonRoot = requireLesson(flags);
  const records = listRecords(lessonRoot);
  if (!records.length) die('no run records to render');
  const logPath = path.join(lessonRoot, 'lesson_build.log.md');

  let prologue;
  if (fs.existsSync(logPath)) {
    const existing = fs.readFileSync(logPath, 'utf8');
    const at = existing.indexOf(MARKER);
    // A log written before records existed has no marker: it is history, and it is kept
    // byte for byte. Rendered sections go below it, never over it.
    prologue = at === -1 ? existing : existing.slice(0, at);
  } else {
    const first = records[0];
    prologue =
      `# Lesson Build Log — ${first.lesson.course} / ${first.lesson.slug}\n` +
      `Started: ${first.started}\n` +
      `Skill: lesson-builder (run record ${SCHEMA})\n`;
  }

  // Exactly one blank line between the preserved text and the marker, whatever the preserved
  // text ends with — so re-rendering an unchanged record rewrites the same bytes.
  const gap = prologue.endsWith('\n\n') ? '' : prologue.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(logPath, `${prologue}${gap}${MARKER}\n\n${records.map(renderRun).join('\n')}`);
  process.stdout.write(`${logPath}\n`);
}

function requireLesson(flags) {
  if (!flags.lesson) die('--lesson <lesson_root> is required');
  if (!fs.existsSync(flags.lesson)) die(`no lesson root at ${flags.lesson}`);
  return flags.lesson;
}

// ---------- main ----------

const [cmd, ...rest] = process.argv.slice(2);
const { flags, positional } = parseArgs(rest);
const commands = {
  init: () => cmdInit(flags),
  current: () => cmdCurrent(flags),
  get: () => cmdGet(flags, positional),
  set: () => cmdSet(flags, positional),
  append: () => cmdAppend(flags, positional),
  'plan-hash': () => cmdPlanHash(flags),
  approve: () => cmdApprove(flags),
  stage: () => cmdStage(flags),
  promote: () => cmdPromote(flags),
  fail: () => cmdFail(flags),
  render: () => cmdRender(flags),
};
if (!cmd || !commands[cmd]) {
  process.stderr.write(
    `usage: run-manifest.cjs <${Object.keys(commands).join('|')}> --lesson <dir> [...]\n` +
      'see the header of this file, or references/run-record.md\n',
  );
  process.exit(1);
}
commands[cmd]();
