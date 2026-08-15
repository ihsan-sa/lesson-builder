# evals/teaching — calibration and benchmark assets for the discourse layer

What lives here and how to run it. Rules under test: `references/teaching-communication.md`. Reviewer under test: `agents/content-review-agent.md`. Tutor under test: `_lesson-core/chat/buildSystemPrompt.js`.

| File | What | Blind? |
|---|---|---|
| `lesson-fragments/R01.md … R12.md` | 12 reviewer fixtures — assembled-topic fragments each seeded with one discourse defect (decorative analogy; irrelevant historical fact; causal argument as bullets; undefined symbol; hidden inference jump; consequence before prerequisite; duplicated KeyConcept; recap restating prose; example before its concept; two-claim paragraph; generic "Overview" heading over one paragraph; exit check requiring an untaught definition) | Yes — pass to the reviewer as-is |
| `tutor-cases.jsonl` | `set: fixture` — 12 tutor transcripts each seeded with one failure (six probe failures + preamble; 300-word lookup; full solution where a hint was warranted; "explain everything" as a chapter; bulleted derivation; "make it engaging" with jokes). `set: probe` — the six Stage 1 live probes (student messages only). `set: stage5` — 100 stratified live cases (15% lookup / 20% concept / 15% derivation / 10% comparison / 25% problem tutoring / 10% misconception / 5% expert), varying prior knowledge, verbosity, requested depth, work correctness, analogy temptation, answer style, and second turns | Fixture rows: yes (transcript only) |
| `expected-failures.json` | Answer key: required kinds + minimum severity per fixture, clean passages to watch, expected probe behaviour | **Never** given to the reviewer or tutor under test |
| `rubric.md` | Part A: the 0–3 lesson rubric the reviewer scores, with gates. Part B: pairwise judging rubric for Stage 5 | — |

## Stage 4 — reviewer calibration (run after any edit to the reviewer prompt or the rules)

1. Copy `lesson-fragments/` and the fixture rows of `tutor-cases.jsonl` (`set == "fixture"`, transcript + mode + answer_style only) into a scratch directory **without** `expected-failures.json` — the reviewer must not be able to glob the key. Copy `agents/content-review-agent.md` and `references/teaching-communication.md` beside them.
2. Spawn the reviewer (judgment work: `opus` floor per the `SKILL.md` model policy) with:

   ```
   mode: new
   input_kind: fixtures
   fixture_path: <scratch>/lesson-fragments/     (one review per file, location = "R<NN>")
   audience_level: first-year undergraduate, first exposure to AC circuits and to differential equations
   ```

   and, in a second spawn (or the same one after the fragments):

   ```
   input_kind: tutor_transcript
   cases: <scratch>/tutor-fixtures.jsonl        (location = "T<NN>")
   ```

3. Grade against `expected-failures.json`: every fixture must have ≥1 issue whose kind is in `required_kinds` with severity ≥ `min_severity` (24/24 to pass). Record over-firing on `clean_passages` (a `major` there) — it does not fail the run but the calibration text in the agent file should be tightened.
4. On a miss: read the reviewer's own summary for that fixture, sharpen the corresponding kind's definition or calibration line in `agents/content-review-agent.md` (never by naming the fixture), re-run. Two consecutive misses on the same fixture after a prompt change → surface to the user; the rule itself may be underspecified.
5. Record the run (date, model, result) in the commit message that carries the change — not in this directory.

## Stage 1 — tutor probes (run after any edit to `buildSystemPrompt.js`)

Run the `set == "probe"` rows (and a handful of `stage5` rows across modes) through the real runtime path — `claude -p --system-prompt <built prompt> --tools ""` with the lesson's `LESSON_CONTEXT` and an `[ACTIVE CONTEXT]` block prepended to each message, `--resume` for `followup` turns — using the tutor's default model. Grade probes against `expected-failures.json` → `probes`; grade the others mechanically (words vs. mode budget, questions per turn, banned openers/closers, unrequested analogies, hedges) and by reading. Pass: every probe behaves as expected; zero banned openers/closers; zero unrequested analogies; median turn within its mode budget. Budgets are review signals — a turn over budget with a stated expansion trigger is not a failure.

## Stage 5 — blind pairwise tutor eval (cost-bearing; run on request)

Run all `stage5` rows through the OLD and NEW prompts, anonymize and randomize A/B order, judge each pair against `rubric.md` Part B with a rubric-tied reason, then break down by mode and by attribute (`prior_knowledge`, `work_correctness`, `answer_style`, `followup`). Report win/tie/loss with reasons — never average length. The lesson-side half (6–10 generated topics across knowledge types, delayed recall and near/far transfer) needs real builds and human learners; it is tracked in `ROADMAP.md`.

## Stage 3 — reorder test

`references/phase-2-plan.md` § Teaching arc requires rejecting any candidate arc whose moves can be reordered without changing meaning. Testing evidence for that rule: `plan-rejection-case.md` in this directory records one candidate content-list plan and its rejection. Add a real rejection from a live run when one occurs.
