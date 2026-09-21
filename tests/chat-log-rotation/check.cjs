// chat.log rotation (_lesson-core/server/chatLog.js). No proxy, no packages:
// imports the module and drives it against temp directories with an injected
// clock. Each case builds its own directory.
//
//   1  the log rotates at 1 MB and keeps logging into a new chat.log
//   2  the log rotates when its first line is 30 days old, not before
//   3  prune: an old generation without .done is kept; with .done it goes;
//      a young one with .done is kept; nothing else in the directory, nor
//      anything outside it, is touched
//   4  the scaffold's .gitignore ignores chat.log and chat.log.1789000000
//
// Exit 0 when every check holds.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const SKILL = path.resolve(__dirname, "../..");
const B = path.join(SKILL, "references", "bootstrap");
let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "chat-log-rotation-"));
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-21T12:00:00Z");
const line = (t, text) => `[${new Date(t).toISOString()}] [CHAT_OK] ${text}\n`;
const ls = (d) => fs.readdirSync(d).sort();

(async () => {
  const { createChatLog, MAX_BYTES, MAX_AGE_MS } = await import(pathToFileURL(path.join(B, "_lesson-core", "server", "chatLog.js")).href);
  ok(MAX_BYTES === 1024 * 1024 && MAX_AGE_MS === 30 * DAY, "0: thresholds are 1 MB and 30 days");

  // ---------------------------------------------------------------- case 1
  {
    const d = tmp(); const f = path.join(d, "chat.log");
    const append = createChatLog(f, { now: () => NOW });
    const pad = "x".repeat(64 * 1024);
    while (!fs.existsSync(f) || fs.statSync(f).size < MAX_BYTES) append(line(NOW, pad));
    ok(ls(d).join() === "chat.log", `1: a log that reached 1 MB has not rotated before the next line (${ls(d)})`);
    append(line(NOW, "AFTER"));
    const gen = `chat.log.${Math.floor(NOW / 1000)}`;
    ok(ls(d).join() === `chat.log,${gen}`, `1: the next line rotates it to ${gen} (${ls(d)})`);
    ok(fs.readFileSync(f, "utf8") === line(NOW, "AFTER"), "1: and starts a new chat.log with that line");
    ok(fs.statSync(path.join(d, gen)).size >= MAX_BYTES && !fs.readFileSync(path.join(d, gen), "utf8").includes("AFTER"), "1: the generation holds the old lines and not the new one");
    append(line(NOW, "MORE"));
    ok(ls(d).length === 2 && fs.readFileSync(f, "utf8").endsWith(line(NOW, "MORE")), "1: and keeps logging there without rotating again");
    fs.rmSync(d, { recursive: true });
  }

  // ---------------------------------------------------------------- case 2
  {
    const d = tmp(); const f = path.join(d, "chat.log");
    let now = NOW;
    const append = createChatLog(f, { now: () => now });
    append(line(NOW, "FIRST"));
    now = NOW + MAX_AGE_MS - 1000;
    append(line(now, "DAY-29"));
    ok(ls(d).join() === "chat.log", `2: a log whose first line is under 30 days old is not rotated (${ls(d)})`);
    now = NOW + MAX_AGE_MS;
    append(line(now, "DAY-30"));
    ok(ls(d).length === 2 && fs.readFileSync(f, "utf8") === line(now, "DAY-30"), `2: at 30 days it rotates and the line starts the new log (${ls(d)})`);
    fs.rmSync(d, { recursive: true });
  }

  // ---------------------------------------------------------------- case 3
  {
    const root = tmp(); const d = path.join(root, "server"); fs.mkdirSync(d);
    const outside = path.join(root, "outside.log"); fs.writeFileSync(outside, "keep");
    const epoch = (daysAgo) => Math.floor((NOW - daysAgo * DAY) / 1000);
    const oldDone = `chat.log.${epoch(31)}`, oldBare = `chat.log.${epoch(40)}`, young = `chat.log.${epoch(29)}`;
    const w = (n, s = "x") => fs.writeFileSync(path.join(d, n), s);
    w(oldDone); w(oldDone + ".done", "");
    w(oldBare);                                   // old, no marker: must survive
    w(young); w(young + ".done", "");             // marked, but not old enough
    // Old and marked, but not a generation by name, or not a regular file.
    const decoys = [`chat.log.${epoch(31)}.bak`, `chat.logx.${epoch(31)}`, `other.log.${epoch(31)}`, `chat.log.${epoch(31)}a`];
    for (const n of decoys) { w(n); w(n + ".done", ""); }
    const dirGen = `chat.log.${epoch(50)}`; fs.mkdirSync(path.join(d, dirGen)); w(dirGen + ".done", "");
    const linkGen = `chat.log.${epoch(60)}`; fs.symlinkSync(outside, path.join(d, linkGen)); w(linkGen + ".done", "");
    // A lone .done marker with no generation beside it.
    w(`chat.log.${epoch(70)}.done`, "");

    createChatLog(path.join(d, "chat.log"), { now: () => NOW });
    const left = new Set(ls(d));
    ok(!left.has(oldDone) && !left.has(oldDone + ".done"), "3: a generation over 30 days old with .done is deleted, marker and all");
    ok(left.has(oldBare) && fs.readFileSync(path.join(d, oldBare), "utf8") === "x", "3: a generation 40 days old WITHOUT .done survives, content intact");
    ok(left.has(young) && left.has(young + ".done"), "3: a generation 29 days old with .done survives");
    ok(decoys.every((n) => left.has(n) && left.has(n + ".done")), "3: files whose name is not exactly chat.log.<digits> survive");
    ok(fs.statSync(path.join(d, dirGen)).isDirectory() && left.has(linkGen) && fs.readFileSync(outside, "utf8") === "keep", "3: a directory or symlink named like a generation survives, and the file the link points at is untouched");
    ok(left.has(`chat.log.${epoch(70)}.done`), "3: a lone .done marker is left alone");
    ok(ls(root).join() === "outside.log,server", "3: nothing outside the log's directory changed");
    // The same generation, once a reader marks it.
    w(oldBare + ".done", "");
    createChatLog(path.join(d, "chat.log"), { now: () => NOW });
    ok(!fs.existsSync(path.join(d, oldBare)), "3: once marked .done, the 40-day generation goes at the next open");
    fs.rmSync(root, { recursive: true });
  }

  // ---------------------------------------------------------------- case 4
  {
    const d = tmp();
    fs.copyFileSync(path.join(B, "lesson-template", ".gitignore"), path.join(d, ".gitignore"));
    execFileSync("git", ["init", "-q", d]);
    const ignored = (p) => { try { execFileSync("git", ["-C", d, "check-ignore", "-q", p]); return true; } catch (_) { return false; } };
    ok(ignored("server/chat.log") && ignored("server/chat.log.1789000000") && ignored("server/chat.log.1789000000.done"),
      "4: the lesson scaffold's .gitignore ignores chat.log, chat.log.1789000000 and its .done");
    ok(!ignored("server/proxy.js"), "4: and still tracks server/proxy.js");
    fs.rmSync(d, { recursive: true });
  }

  console.log(failures === 0 ? `\nALL ${checks} CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
