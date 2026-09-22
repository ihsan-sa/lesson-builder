// Asserts on the system prompt the proxy hands the CLI, read back from the fake's record, and on
// the prompt the browser builds for a hosted session, which no proxy ever touches.
// Brief: "the tutor's system prompt carries the ABSOLUTE served workspace root once".
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { PROXY_URL, REAL, LINK, WS, SKILL } = process.env;
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };
const post = async (route, body) => { const r = await fetch(PROXY_URL + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
const spawns = () => fs.readFileSync(path.join(WS, "record.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const count = (s, sub) => s.split(sub).length - 1;
const addDirs = (args) => args.flatMap((a, i) => (a === "--add-dir" ? [args[i + 1]] : []));
// The prompt as the CLI got it: on argv, or demoted into stdin.
const promptOf = ({ args, stdin }) => { const i = args.indexOf("--system-prompt"); return i >= 0 ? args[i + 1] : stdin; };

(async () => {
  const { buildSystemPrompt, withWorkspaceRoot, STUDY_RECORD_RULE, FILE_ACCESS_LINE } = await import(pathToFileURL(path.join(SKILL, "references/bootstrap/_lesson-core/chat/buildSystemPrompt.js")).href);
  const root = fs.realpathSync(REAL);
  ok(path.isAbsolute(root) && root !== LINK && fs.realpathSync(LINK) === root, `the checkout is reached through a symlink (${LINK} -> ${root})`);

  const props = { courseCode: "DEMO 101", courseName: "Demo", lessonFile: "src/demo.jsx" };
  // The hosted tutor (lessons/chat.py) sends this prompt on unchanged: it must name no root, and
  // no rule in it may send the tutor to a path that was never filled in.
  const unfilled = buildSystemPrompt({ ...props, lessonContext: "Unit 1: two-port networks.", isolatedFlag: true });
  ok(!unfilled.includes("@@"), "the prompt the browser builds carries no unfilled token");
  ok(count(unfilled, "WORKSPACE_ROOT") === 0, "...and names no workspace root at all");
  ok(unfilled.includes(FILE_ACCESS_LINE) && /Glob/.test(FILE_ACCESS_LINE) && !/WORKSPACE_ROOT/.test(FILE_ACCESS_LINE),
    "...and its file-access fallback is a plain Glob, not one confined to a root that is missing");

  const filled = withWorkspaceRoot(unfilled, "/srv/x");
  const afterStudyRecord = filled.slice(filled.lastIndexOf(STUDY_RECORD_RULE)).split("\n");
  ok(count(filled, "WORKSPACE_ROOT=/srv/x ") === 1, "withWorkspaceRoot adds the root line once");
  ok(afterStudyRecord[1].startsWith("WORKSPACE_ROOT=/srv/x "), "...on the line right after the study-record block");
  ok(/never elsewhere\.$/.test(afterStudyRecord[1]), "...and that line is the one confining the Glob and find fallbacks");
  ok(withWorkspaceRoot(filled, root) === filled, "a prompt that already names a root is left alone");
  ok(withWorkspaceRoot(unfilled, null) === unfilled && withWorkspaceRoot("no study record here", root) === "no study record here",
    "no root, or no anchor to hang it on, leaves the prompt untouched");
  const given = buildSystemPrompt({ ...props, lessonContext: "", isolatedFlag: true, workspaceRoot: "/srv/x" });
  ok(count(given, "WORKSPACE_ROOT=/srv/x ") === 1 && !given.includes("@@"), "a caller that knows the root passes it to buildSystemPrompt instead");

  for (const isolated of [true, false]) {
    const tag = isolated ? "isolated" : "shared";
    const before = fs.existsSync(path.join(WS, "record.jsonl")) ? spawns().length : 0;
    const system = buildSystemPrompt({ ...props, lessonContext: "", isolatedFlag: isolated });
    const r = await post("/session/init", { isolated, system });
    ok(r.status === 200, `${tag}: /session/init answers 200 (${r.status})`);
    const s = spawns().slice(before).find((x) => !x.args.includes("--help") && !x.args.includes("--version"));
    if (!s) { ok(false, `${tag}: a CLI spawn was recorded`); continue; }
    const p = promptOf(s);
    ok(count(p, "WORKSPACE_ROOT=") === 1, `${tag}: the prompt names WORKSPACE_ROOT exactly once`);
    ok(p.includes(`WORKSPACE_ROOT=${root} `), `${tag}: ...as the symlink-resolved checkout (${root})`);
    ok(!p.includes(LINK) && !p.includes("@@"), `${tag}: neither the symlink path nor an unfilled token reaches the CLI`);
    // Control: without the realpath the root would be the symlink — the proxy's REPO_DIR is it here.
    ok(addDirs(s.args).at(-1) === LINK, `${tag}: the proxy's REPO_DIR (last --add-dir) is the unresolved symlink (${addDirs(s.args).at(-1)})`);
  }
  console.log(failures ? `${failures} failed` : "all passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
