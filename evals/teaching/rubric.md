# Teaching-quality rubric

Two instruments. **Part A** is the lesson-prose rubric `content-review-agent` scores per topic in its discourse pass (0–3 per dimension). **Part B** is the pairwise judging rubric for the Stage 5 tutor eval (blind old-vs-new, order randomized, rubric-tied reasons required). Rules these enforce live in `references/teaching-communication.md`.

## Part A — lesson topic rubric (0–3 per dimension)

Score the rendered topic against its `teaching_arc` and the stated `audience_level`. 3 = fully meets; 2 = minor lapses that cost the learner nothing important; 1 = a lapse the intended learner will feel; 0 = the dimension is absent or broken.

| Dimension | 3 | 0 |
|---|---|---|
| **purpose** | Every section and paragraph has a stated purpose serving the `central_question`; nothing is there "because it's relevant" | Purposes unstateable; content assembled, not aimed |
| **macro-order** | Every idea rests only on ideas above it or on `entry_state`; no consequence before rule, exception before base case, representation before it is taught | A dependency inverted in a way that blocks understanding |
| **explanatory adequacy** | Every claim the arc meant to explain comes with its mechanism or warrant; the gate question is answered yes | Claims asserted without mechanism; the learner is told *that*, never *why* |
| **paragraph unity** | One controlling claim per paragraph, stated early and completed | Paragraphs with none or with several |
| **cohesion** | Given-to-new inside paragraphs; transitions say why the next idea follows; one stable name per concept; paragraphs end on conclusions | Sentences start from unintroduced entities; subject changes without bridges |
| **inference burden** | No step the intended learner cannot supply is left unstated; no obvious step is narrated for an audience that has it | A required inference is missing (0), or every trivial step is spelled out for experts (1) |
| **terminology** | Every symbol and term defined at first use, used consistently, validity conditions beside the claim | Symbols carrying the point undefined; names drift |
| **format fit** | Representation matches structure (prose for causal chains, table for repeated dimensions, numbered list for order, bullets only for parallel items with a stem, a figure for a shape, a structure or a change across stages); headings mark moves | Causal argument as bullets; decorative headings; nested lists |
| **example design** | Each example performs its declared function and lands after the learner knows what to notice | Examples before their concept, or undeclared / non-discriminating |
| **economy** | No redundant move; each proposition said once in the representation that carries it | Restatement across paragraph + callout + summary; seductive detail |
| **adaptation** | Density calibrated to the stated audience (worked detail for novices, none for experts) | Explanations pitched at the wrong audience throughout |
| **closure** | Ending synthesizes to the `exit_model`; exit checks require the model and introduce nothing new | Recap restating the body; check needing an untaught definition; no synthesis |

**Gates** (applied by main Claude when compiling Phase 4 findings; the reviewer reports them tripped):

- Any **0 on macro-order, explanatory adequacy, inference burden, or terminology** → a `major` on the topic.
- **Average < 2.0** → the topic is a revise (fix-loop item, not a forward-as-known-issue).
- **Never ship economy = 3 with adequacy ≤ 1.** A topic that is short because reasoning was deleted has failed, however clean it reads.

## Part B — tutor pairwise judging (Stage 5)

Judges see two anonymized replies (A/B, order randomized) to the same case from `tutor-cases.jsonl` and choose the better one, or "tie", **with a reason tied to one or more of the dimensions below**. A preference without a rubric-tied reason is discarded. Average length is not a dimension.

| Dimension | Ask |
|---|---|
| logical sequence | Does each idea rest on what came before? |
| inference completeness | Is every step the student needs stated, and no needed step deleted? |
| directness | Does it answer the exact question first, without preamble or restating? |
| information economy | Is anything there merely because it is relevant? |
| coherence | Connected argument, or assembled facts? |
| representation fit | Prose / equation / list / table / figure chosen by structure, not variety? |
| terminology precision | Symbols and terms defined and stable; conditions stated? |
| example quality | In-domain, discriminating, placed after the feature to notice is known? |
| analogy discipline | None by default; if present, requested or justified, mapped, bounded, returned to formal terms? |
| adaptive support | Right mode and budget for this student's evidence (prior knowledge, work correctness, answer style)? Hint ladder respected; worked-solution-for-study honoured? |
| question justification | Was each question the tutor asked pedagogically justified — its answer changes the next instruction — and was there at most one? |
| stance under pressure | Re-checks under pushback; corrects when wrong, maintains when right; never validates false work? |

**Success criterion for the whole eval: unaided learning and transfer** (delayed recall, near/far transfer on the lesson eval; correct unaided next steps on the tutor eval) — never assisted performance or satisfaction ratings.
