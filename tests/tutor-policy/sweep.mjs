#!/usr/bin/env node
// Re-measures the assembled tutor prompt over every lesson of a real lessons checkout and
// prints the largest, so LARGEST_CONTEXT_CHARS in check.cjs can be bumped when the sweep
// grows. Not in the gate: it needs the lessons repo, which the gate's clean checkout lacks.
//
//   LESSONS_DIR=~/dev/lessons node tests/tutor-policy/sweep.mjs
//
// Reads each lesson's LESSON_CONTEXT out of its source; builds with the same generous
// stand-in props check.cjs uses, so the numbers compare. Exit 1 when any lesson is over the
// ceiling, else 0.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKILL = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const { buildSystemPrompt } = await import(pathToFileURL(path.join(SKILL, "references/bootstrap/_lesson-core/chat/buildSystemPrompt.js")).href);
const CEILING = 28000;
const root = path.join(process.env.LESSONS_DIR || path.join(process.env.HOME, "dev", "lessons"), "lessons");
if (!fs.existsSync(root)) { console.error(`no lessons at ${root}: set LESSONS_DIR`); process.exit(2); }

const props = { courseCode: "ECE 999", courseName: "Some Long Course Name For Measuring", institution: "University of Waterloo", lessonFile: "src/some_lesson.jsx", isolatedFlag: true };
const rows = [];
for (const course of fs.readdirSync(root)) {
  const d = path.join(root, course, "claude_lessons");
  if (!fs.existsSync(d)) continue;
  for (const lesson of fs.readdirSync(d)) {
    const src = path.join(d, lesson, "src");
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".jsx"))) {
      const m = fs.readFileSync(path.join(src, f), "utf8").match(/const LESSON_CONTEXT = `([\s\S]*?)`;/);
      if (!m) continue;
      rows.push({ lesson: `${course}/${lesson}`, ctx: m[1].length, prompt: buildSystemPrompt({ ...props, lessonContext: m[1] }).length });
    }
  }
}
rows.sort((a, b) => b.prompt - a.prompt);
console.log(`${rows.length} lessons; base (empty context) ${buildSystemPrompt({ ...props, lessonContext: "" }).length}; ceiling ${CEILING}`);
for (const r of rows.slice(0, 5)) console.log(`  ${r.prompt}  ctx ${r.ctx}  ${r.lesson}`);
const over = rows.filter((r) => r.prompt > CEILING);
console.log(over.length ? `${over.length} over the ceiling` : `largest LESSON_CONTEXT ${rows[0]?.ctx ?? 0} chars (LARGEST_CONTEXT_CHARS in check.cjs)`);
process.exit(over.length ? 1 : 0);
