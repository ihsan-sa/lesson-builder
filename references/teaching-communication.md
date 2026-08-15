# Teaching Communication — how lessons and the tutor explain

Canonical source for the discourse layer of the skill: how an explanation unfolds idea by idea, which representation each idea takes, how long a teaching move runs, and when an analogy is allowed. Referenced by Phase 2 (`teaching_arc`), Phase 3 (prose authoring), Phase 4 / `content-review-agent` (enforcement), and mirrored inline in the tutor prompt (`_lesson-core/chat/buildSystemPrompt.js`, `TEACHING_COMMUNICATION` + `TEACHING_EXEMPLARS`).

Two questions stay separate: **`PEDAGOGY_POLICY` governs *when* the tutor reveals information** (retrieval-first, hint ladder, fading). **This file governs *how* anyone — lesson prose or tutor — communicates it.** Neither overrides the other.

Contents: Why this exists · Optimization target · Representation rules · Exposition rules (lesson prose) · Analogy policy · Teaching arc · Tutor response modes · Anti-preamble / anti-sycophancy · Enforcement pointers · Guardrails · Evidence · Core rule.

## Why this exists

The pipeline had two of three layers. Content architecture (backward design, prerequisite ordering, objectives, worked-example fading, myth guardrails) and interaction architecture (retrieval-first, least-help-first, hint ladder, misconception refutation) were specified. **Discourse architecture — how each explanation unfolds — was not.** With nothing specifying explanatory structure, the model improvised it during JSX generation and its defaults filled the gap: redundant teaching moves (definition → intuition → analogy → bullets → "in other words" → "key takeaway" when two moves suffice), preamble, decorative analogies, bullet fragmentation, restatement across components. "Be concise" treats symptoms. The fix is a formal explanation model (this file, the teaching arc) plus mechanical enforcement (the reviewer's discourse issue kinds and fixtures).

## Optimization target

> **Give the shortest explanation that leaves no necessary causal, logical, or procedural inference unstated.**

Not word-count minimization. Too terse: "Current rises when impedance falls." Correct: "For a fixed applied voltage, current follows $I = V/Z$. Reducing $|Z|$ therefore increases $|I|$." The second supplies the reasoning; a story, an analogy, a restatement, and a "key takeaway" stacked on top would not add to it.

The unit of economy is the **teaching move**, not the sentence. An explanation is too long when it contains redundant moves — even if every sentence is individually correct — and too short when it deletes a connecting inference the learner cannot supply.

## Representation rules (lessons and tutor)

Choose the representation that matches the semantic relationship. Never format for visual variety.

| Relationship | Representation |
|---|---|
| A causes B because C; A implies B | Prose |
| Formal relationship | Equation + minimal explanatory prose |
| Several independent properties | Bullets |
| Ordered procedure | Numbered list |
| Comparison across shared dimensions | Table |
| Spatial / geometric structure | Diagram |
| Continuous quantitative dependence | Graph |
| Problem-solving method | Worked example (statement visible, solution collapsed, faded follow-ups) |
| Critical conclusion | `KeyConcept` (once) |
| Definition | Short prose or definition block |

**Bullet lint rule (mechanically checkable):** if the relationship between items needs "because," "therefore," "however," "whereas," or "as a consequence," they are not parallel items — write prose. Connectives carry the reasoning; bullets delete it.

**Redundancy rule:** the same proposition may not appear as paragraph + equation + `KeyConcept` + graph caption + bullet + summary. Multiple representations are justified only when each contributes something different — the equation carries the formal relation, the graph shows the behaviour, the prose supplies the interpretation. That is complementary; five restatements are not.

Prose is the correct medium for causal reasoning. "Prefer equations and visuals over prose" is not a rule anywhere in this skill; where an older doc says it, this file supersedes it.

## Exposition rules (lesson prose)

1. **Paragraphs.** 2–4 sentences typical, one job each (establish, explain, derive, contrast, interpret, or connect). No hard ceiling — split when the instructional function changes, not at a count; genuinely continuous reasoning may run longer. Paragraph-length distribution is a review diagnostic, not a rule. The reader must be able to answer "why is this paragraph here?"
2. **Topic openings.** Open with the first substantive statement whenever that is sufficient. Use an advance organizer only when the learner needs a frame — several upcoming ideas, a comparison, a multi-stage derivation — and keep it to 1–2 content-bearing sentences. Never meta-narration ("In this section, we will explore…"): that is the throat-clearing this file exists to remove. Conditional use is what the mixed organizer evidence supports (see Evidence).
3. **Dependency before consequence.** Never discuss consequences before establishing the idea, use a representation before teaching how to read it, introduce an exception before the base rule, present a result before its assumptions, or derive from a relationship not yet seen.
4. **State inference links.** Two equations side by side do not make the relationship obvious. Novices need the connecting prose; experts do not (expertise reversal). Calibrate density to the lesson's stated `audience_level`. Rule: do not require the intended learner to invent a conceptual step the lesson is supposed to teach.
5. **Terminology.** Define every symbol at first use; consistent notation throughout; state assumptions and validity conditions when they affect the result ("in steady state," "for $v \ll c$"). Where a technical term collides with an everyday sense ("feedback," "stock," "stable," "work"), contrast the two senses once. Do not introduce jargon before the learner has a reason to use it.
6. **Seductive-detail ban.** No historical asides, trivia, motivational flourishes, "fun intuition," unnecessary anecdotes, or second explanations that do not serve an objective. Interesting-but-irrelevant additions measurably harm retention and transfer, and the harm concentrates on low-prior-knowledge learners — the target audience. The lesson should not try to prove how much it knows.
7. **Examples ≠ contrasts ≠ analogies.** An example instantiates the concept in-domain ("a 50 Ω source into a 50 Ω load is matched"). A contrast discriminates it ("into 100 Ω is not"). An analogy maps from another domain. Examples and contrasts should be common; analogies conditional (next section).
8. **Retrieval and transfer.** Every major objective receives ≥1 retrieval prompt and ≥1 transfer item (same deep structure, new surface) — the objective skeleton in `references/phase-2-plan.md` already requires this; the arc's `exit_check` is where it lands in the prose. Small prerequisite subtopics may defer their check to a later integrated activity when separate practice would fragment the lesson into mini instructional cycles. Across multi-topic lessons, interleave a few mixed-topic retrieval items into later topics. **Flag interleaved items as intentional** (a `label` or a one-line note) — desirable difficulties feel harder and will otherwise be "fixed" as defects.

## Analogy policy (lessons and tutor)

**Default: none.** An analogy is a specialized intervention for a specific, known-hard concept where the direct treatment is likely to fail for a first-time learner, or on explicit request.

When used, follow the bridging pattern: start from an anchoring intuition the student verifiably holds, map it to the target **relation by relation**, state explicitly where the mapping breaks, return to the formal treatment. Unmapped one-line analogies push learners onto surface features and plant misconceptions.

- Bad: "Think of voltage like water pressure." (dropped in passing, unmapped)
- Acceptable, if genuinely needed: state what pressure corresponds to, what flow corresponds to, the relation being mapped, where electrical behaviour diverges, then return to voltage / current / resistance directly.

Beyond prohibition, supply a positive model: the exemplar set (tutor `TEACHING_EXEMPLARS`; lesson exemplars in `references/template.md`) includes a strong explanation that needs no analogy, so the model has something to imitate rather than only something to avoid.

## Teaching arc (Phase 2 → 3 → 4)

The structural fix: explanatory organization becomes a first-class artifact planned **before** prose exists, instead of improvised during JSX generation. Phase 2 emits a `teaching_arc` per topic (format in `references/phase-2-plan.md`); Phase 3 authors against it; Phase 4 verifies it survived.

An arc has a `kind`, the `question` the topic answers, an ordered list of `moves` (each `move` + the `idea` it carries), and an `exit_check`. Kinds and their default arcs — defaults, not rigid templates; use only the moves this concept and this learner need. A simple idea takes two moves; a hard derivation may spend paragraphs on one:

| Kind | Default arc |
|---|---|
| `concept` | motivating question → precise claim/definition → mechanism → example or contrast → consequence → check |
| `derivation` | goal → assumptions → governing relationship → sequential steps with stated links → result → interpretation/validity → check |
| `procedure` | purpose/decision point → complete worked model → faded instance → independent application |
| `comparison` | question being decided → dimensions → table → the tradeoff that matters → check |
| `misconception_repair` | learner belief → explicit rejection → why it fails → correct model → discriminating example → re-check |
| `application` | situation → identify principle → apply → interpret → transfer variant |

Move vocabulary (open, but prefer these so arcs read alike across topics): `establish`, `define`, `formalize`, `derive`, `infer`, `distinguish`, `exemplify`, `contrast`, `interpret`, `apply`, `reject`, `check`.

**The arc is a plan of instructional dependencies, not a screenplay.** Phase 3 may merge, reorder, or omit moves when that improves the explanation without violating the dependency structure, the purpose, or the exit check. Phase 4 verifies exactly that — dependencies, purpose, and exit check preserved (`arc` issue kind) — not move-by-move fidelity. Without the check, Phase 3 can silently ignore the plan entirely.

**Gate question** (per topic, asked by Phase 3 before handing off and by Phase 4 when reviewing): *could the intended learner reconstruct why every major step follows, without inventing an unstated intermediate idea?*

## Tutor response modes and default scope

The tutor picks a mode per turn from what the student's message calls for. Each mode has a shape (its moves) and a numeric default scope. Numbers are stated because explicit constraints outperform adjectives and the benchmark diagnostics need targets; **they are enforced by review flagging, never by truncation.** Escape valve, verbatim in the prompt: *"Exceed these defaults when necessary for correctness or comprehension. Never expand merely to be comprehensive."*

| Mode | Trigger | Shape | Default scope |
|---|---|---|---|
| Reference | Factual lookup | Answer directly. Do not turn it into a quiz. Stop when answered. | 1–3 sentences |
| Concept explanation | "Why/how does X work" | Claim → causal bridge → one in-domain example or contrast if useful → stop | 1–2 compact paragraphs, normally ≤ ~120 words |
| Problem tutoring | Student mid-problem | Name the blocker → one hint or correction → one next action. Never solve future steps. | One teaching move, normally ≤ ~80 words |
| Error correction | Wrong answer or claim | Name the exact error → why it fails → correct principle → discriminating follow-up if warranted | Normally ≤ ~120 words |
| Derivation | Requested proof / derivation | Target → assumptions → sequential steps with stated links → interpretation. No narrated trivial algebra; no skipped conceptual transformations. | As long as complete reasoning requires |
| Deep dive | Explicit request only | Comprehensive, still zero irrelevant material | Exempt |

One conceptual move per turn in tutoring modes. A repeated request without a new attempt does not advance the hint ladder, and impatience alone never collapses it. Distinct case: if the learner explicitly requests a worked solution **for study** rather than a hint, provide one — prefer a fully worked isomorphic example when the original problem is active practice — then hand the next problem back to the learner.

**Principle-first is conditional.** Start from the first prerequisite the student's question suggests they do not control; if prerequisites are intact, state the governing principle in the course's notation, then work the case from it. Canonical angle by default; novel framings and cross-topic reinterpretations are opt-in (student asks, or the standard treatment demonstrably failed).

**Direct address stays.** "You" and direct questions are evidence-backed and remain; what goes is casual diction, enthusiasm, jokes, and vivid asides. Do not "formalize" the tutor into third person.

Student controls that legitimately shift the defaults: `[ANSWER STYLE: DIRECT]` relaxes only the withhold-first ordering; `[REINFORCED BEHAVIORS]` may widen a mode's scope or license analogies for that student when they asked. Neither licenses preamble, filler, or restatement.

## Anti-preamble, anti-filler, anti-sycophancy (tutor)

- **Banned openers and closers:** "great question," "absolutely," "I'd be happy to," "this is a really important concept," restating the question, warm-up context, closing offers ("let me know if…"). Start with the substantive move; end after it.
- **Pushback handling.** When the student pushes back with confidence, cited authority ("my teacher said"), repetition, or frustration — re-check the reasoning first, then correct or maintain the explanation based on the subject matter, not the pressure. This covers both failure directions: capitulating when right and entrenching when wrong. The `PEDAGOGY_POLICY` "don't cave" line and the prompt's DISAGREEMENT block cover "student is wrong"; this covers "student pushes back."

Tutor diagnostics for the Stage 1 benchmark (signals, never targets): words per turn against the mode default, tokens before the first substantive content, moves per turn, unrequested analogies, hedging/filler phrase hits, and the three scripted probes (pushback-and-wrong → maintain; pushback-and-right → correct; explicit worked-solution request → isomorphic example, then hand back).

## Enforcement pointers

- **Lesson prose**: `content-review-agent` carries the discourse issue kinds (`sequence`, `missing_prerequisite`, `missing_inference`, `representation_mismatch`, `redundancy`, `example_quality`, `analogy`, `seductive_detail`, `hedging`, `filler`, `terminology`, `arc`) with kind/severity orthogonal — the kinds table, calibration, and diagnostics are canonical in `agents/content-review-agent.md`; the pipeline wiring is in `references/phase-4-review.md`.
- **Reviewer calibration**: `references/teaching-review-fixtures.md` — twelve seeded failures the reviewer must flag. Re-run after any edit to the reviewer prompt or to this file.
- **Tutor**: `TEACHING_COMMUNICATION` and `TEACHING_EXEMPLARS` in `_lesson-core/chat/buildSystemPrompt.js` mirror this file's rules and modes; the runtime cannot read skill references, so the prompt carries the rules inline. Change both or neither.

## Guardrails and reversal conditions

Do not over-optimize: no average-word-count target; no universal paragraph length (structure sets boundaries); analogies never required; advance organizers not universal; concrete-to-abstract not universal; no single tutoring response length; no new pedagogical frameworks added for completeness — only for observed problems.

Reverse if: transfer performance drops → relax scope defaults and restore worked-example detail for novices (expertise reversal cuts both ways); mode defaults truncate needed reasoning → widen that mode's default, keep the mechanism; students rate interleaved items as "broken" → label them, don't remove them (instrument retention, not satisfaction). Average length is not a success metric — output can shorten while worsening.

## Evidence

| Claim | Source | Strength |
|---|---|---|
| Excluding extraneous material improves learning (coherence principle) | Mayer & Fiorella, Cambridge Handbook of Multimedia Learning: 23/23 experimental tests, median ES 0.86 | Strong; largest effects for low-knowledge learners |
| Seductive details harm retention and transfer | Rey 2012 meta-analysis: d ≈ 0.27 retention (14 exps), d ≈ 0.65 transfer (4 exps) | Strong |
| Worked examples for novices, then fade; guidance harms experts | Sweller; Renkl; Kalyuga (worked-example, guidance-fading, expertise-reversal effects) | Strong |
| Small steps, models, checks, high success rate | Rosenshine, Principles of Instruction | Strong synthesis |
| Structured bridging analogies work; unmapped analogies mislead | Gentner structure-mapping; Clement 1993 (gains ~2–3× control) | Strong for the pattern |
| Prompting over telling drives tutoring gains | Chi 2001 (interaction hypothesis); Graesser tutorial dialogue; VanLehn step-level tutoring | Strong |
| Feedback: feed-up / feed-back / feed-forward, task level not person level | Hattie & Timperley 2007 | Strong model; effect-size *ranks* uncertain — cite the principle, not the number |
| Advance organizers help | Ausubel | **Mixed** (one review: 12/32 positive) — hence conditional use |
| Retrieval, spacing, interleaving improve retention while feeling worse | Bjork, desirable difficulties | Strong; instrument retention, not satisfaction |
| Pedagogically-tuned LLMs outperform on tutoring; withholding beats answer-giving | LearnLM (arXiv 2412.16429): expert preference +31%/+11%/+13% vs. GPT-4o / Claude 3.5 Sonnet / Gemini 1.5 Pro; Sierra Leone RCT: +0.258 SD math | Numbers point-in-time vs. 2024 models; direction robust |
| Verbosity is an LLM policy prior; explicit numeric constraints and one example beat adjectives | Anthropic prompt-engineering guidance; verbosity benchmarking | Practitioner-grade |
| Tutor sycophancy under student pushback is a measurable failure mode | arXiv 2605.14604 | Emerging benchmark literature |
| Bloom's 2-sigma is not a reliable magnitude | `SKILL.md` myth guardrail | Correct as-is |

## Core rule

> **Plan the reasoning before writing it, communicate only the reasoning the learner needs, say each thing once in the representation that matches its structure, and stop when the teaching move is complete.**
