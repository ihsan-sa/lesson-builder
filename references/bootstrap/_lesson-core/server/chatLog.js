// chat.log with rotation. The proxy appends one line per event; this keeps the
// file from growing without end and hands finished generations to a reader.
//
//   Rotate: before a line is written, a log of MAX_BYTES (1 MB) or more, or
//   whose first line is MAX_AGE_MS (30 days) old or older, is renamed to
//   <name>.<epoch seconds> and the line starts a new one.
//
//   Prune: a generation <name>.<epoch> is deleted only when its epoch is over
//   30 days old AND <name>.<epoch>.done exists — the marker a reader such as
//   lessons' distill-chats writes when it has taken everything it wants. The
//   marker goes with it. A generation without a marker is never deleted,
//   however old. Prune runs when the log is opened and after each rotation,
//   reads only the log's own directory, and touches only regular files whose
//   whole name is <name>.<digits> or <name>.<digits>.done.
//
// No write, rename or delete here ever throws: a log that cannot rotate keeps
// appending, as the proxy's log() always has.
import fs from "fs";
import path from "path";

export const MAX_BYTES = 1024 * 1024;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch (_) { return false; } };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `now` is for the fixture; the proxy passes nothing.
export function createChatLog(file, { now = Date.now } = {}) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const generationRe = new RegExp(`^${escapeRe(base)}\\.(\\d+)$`);

  // The time of the log's first line, from its [ISO] stamp; null when there
  // is no log or no stamp to read (then only size can rotate it).
  const startedAt = () => {
    try {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(40);
      const n = fs.readSync(fd, buf, 0, 40, 0);
      fs.closeSync(fd);
      const m = /^\[([^\]]+)\]/.exec(buf.toString("utf8", 0, n));
      const t = m ? Date.parse(m[1]) : NaN;
      return Number.isFinite(t) ? t : null;
    } catch (_) { return null; }
  };
  let started = startedAt();

  function prune() {
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { return; }
    for (const name of names) {
      const m = generationRe.exec(name);
      if (!m) continue;
      // "over 30 days old AND its .done marker exists" — both, or it stays.
      const old = now() - Number(m[1]) * 1000 > MAX_AGE_MS;
      const gen = path.join(dir, name);
      const done = gen + ".done";
      if (!old || !isFile(done) || !isFile(gen)) continue;
      try { fs.unlinkSync(gen); fs.unlinkSync(done); } catch (_) {}
    }
  }

  function rotate() {
    let stamp = Math.floor(now() / 1000);
    while (fs.existsSync(`${file}.${stamp}`)) stamp++;
    try { fs.renameSync(file, `${file}.${stamp}`); } catch (_) { return; }
    started = null;
    prune();
  }

  prune();
  return function append(line) {
    try {
      const size = fs.statSync(file).size;
      if (size >= MAX_BYTES || (started !== null && now() - started >= MAX_AGE_MS)) rotate();
    } catch (_) {}
    try {
      fs.appendFileSync(file, line);
      if (started === null) started = startedAt();
    } catch (_) {}
  };
}
