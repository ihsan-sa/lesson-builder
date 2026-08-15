# Teaching-review fixtures — answer key and calibration procedure

Companion to `references/teaching-review-fixtures.md` (the blind set). **Never pass this file to the reviewer under test.** Discourse issue kinds are defined in `agents/content-review-agent.md`; the rules they enforce are in `references/teaching-communication.md`.

## Answer key

`Required kind` must appear on at least one issue for that fixture; the alternatives in parentheses are the pre-existing kinds a reviewer may legitimately use for the same defect (the audit passes on either). `Min severity` is the floor the flagged issue must reach.

| Fixture | Seeded defect | Required kind (accepted alternatives) | Min severity | Typical severity |
|---|---|---|---|---|
| F1 | Decorative one-line analogy ("water pressure") dropped in passing, unmapped | `analogy` | minor | minor |
| F2 | Irrelevant historical fact (Ohm biography) mid-derivation | `seductive_detail` | minor | major (a whole paragraph inside a derivation) |
| F3 | Causal argument rendered as bullets ("Therefore" as a list item) | `representation_mismatch` | minor | major (the whole explanation is bullets) |
| F4 | Undefined symbol at first use (`ω_0` never defined) | `terminology` (`definition`) | major | major |
| F5 | Hidden inference jump: ODE → exponential solution with no stated step, for an audience new to ODEs | `missing_inference` (`derivation`) | major | major |
| F6 | Consequence before its prerequisite: capacitance-falls-under-reverse-bias stated before the depletion region and `C_j = εA/W` are established | `sequence` (`missing_prerequisite`) | minor | major |
| F7 | Duplicated `KeyConcept` (same proposition twice) | `redundancy` (`concision`) | minor | minor |
| F8 | Closing summary that restates the preceding prose | `redundancy` (`concision`) | minor | minor |
| F9 | "Great question…" preamble + closing offer on a tutor turn | `filler` | minor | minor |
| F10 | ~300-word answer to a simple reference question | `mode_scope` | minor | major — also carries `hedging` ("worth noting", "interestingly", "another way to think about it", "the key takeaway") and `seductive_detail` (1881 congress, "mfd" notation, Earth's capacitance); flagging those too is expected, not required |
| F11 | Full solution given where one hint was warranted (first request, no attempt, active practice) | `hint_ladder` | major | major |
| F12 | Technical capitulation after confident student pushback — the tutor was right and now teaches a false statement | `sycophancy` | major | major (a correctness `blocker` on the final turn's claim is also legitimate) |

## Pass criteria

- **Recall (required):** every fixture F1–F12 has ≥1 issue whose `kind` is the required kind or an accepted alternative and whose `severity` ≥ the minimum. One miss fails the calibration.
- **Precision (watch, not fail):** the following are clean and should not draw a `major`: F4's first paragraph, F6's second and third paragraphs, F7's first paragraph and equation, F8's first three paragraphs, F9's middle sentences (the physics is right), F12's first tutor turn (which is correct). A reviewer that majors these is over-firing — record it and tighten the calibration text in the agent file; it does not fail the run.
- **Location discipline:** every issue names its fixture (`location: "F<N>"`). Issues without a locatable fixture are ignored for grading.

## Procedure

1. Spawn `content-review-agent` (Agent tool; model per the `effort_mode` policy in `SKILL.md` — this is judgment work, `opus` floor) with:

   ```
   mode: new
   input_kind: fixtures
   fixture_path: <skill>/references/teaching-review-fixtures.md
   audience_level: first-year undergraduate, first exposure to AC circuits and to differential equations
   ```

   Do not include this key, the seeded-defect list, or any hint about which kinds are expected. Do not include the fixture headings' defect names — the blind file carries none.
2. Grade the returned `issues[]` against the table above. Write the result as a one-line summary (`12/12 flagged` or the list of misses with the kind the reviewer chose instead).
3. On a miss: read the reviewer's own summary for that fixture, then sharpen the corresponding kind's definition or calibration line in `agents/content-review-agent.md` (never by naming the fixture) and re-run. Two consecutive misses on the same fixture after a prompt change → surface to the user; the rule itself may be underspecified in `references/teaching-communication.md`.
4. Re-run whenever `agents/content-review-agent.md` § "Discourse and exposition" or `references/teaching-communication.md` changes, and once per model change of the review tier. Record the run (date, model, result) in the commit message that carries the change — not in this file.
