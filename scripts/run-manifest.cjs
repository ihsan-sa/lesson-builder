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
 *   run-manifest.cjs render   --lesson <dir>
 *
 * `--run` defaults to the newest record in the lesson. Dotted <path>s index into the record
 * (`git.base_sha`, `plan.approval.state`, `phases.3.notes`).
 *
 * Exit codes:
 *   0  ok
 *   1  usage or I/O error
 *   2  init: a record with that run_id already exists (never clobbered)
 *   3  get: the field is unset (absent or null)  |  approve: hash does not match the recorded plan
 *   4  approve: no plan is recorded for this run — approval refers to nothing, so it is not approval
 *   5  approve: the run was aborted by a person; a machine does not un-abort it
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
  if (a.state === 'inherited') return `Approval: INHERITED from consolidation plan ${rec.plan.hash} at ${a.at}`;
  if (a.state === 'pending') return `Approval: PENDING${h}`;
  return `Approval: none recorded${h}`;
}

function renderMedia(rec) {
  if (!rec.media.length) return [];
  return ['Media:'].concat(
    rec.media.map(
      (m) =>
        `  - ${m.media_id || '<no id>'} — intent: ${m.intent || 'unspecified'}` +
        `${m.medium ? ` — ${m.medium}` : ''}${m.original_intent ? ` — original intent: ${m.original_intent}` : ''}` +
        `${m.status ? ` — ${m.status}` : ''}`,
    ),
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
