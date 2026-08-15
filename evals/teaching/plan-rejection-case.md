# Reorder-test rejection — recorded case

Evidence for the Stage 3 benchmark item "at least one candidate plan rejected by the reorder test". The rule: a list of content items is not a teaching arc; if a candidate arc's moves can be reordered without changing meaning, reject it and rebuild from the relations (`references/phase-2-plan.md` § Teaching arc). This case is synthetic (authored 2026-08-15 while landing the v4 spec); replace or supplement it with a rejection from a live run when one occurs.

## Candidate (rejected)

Topic: "Thevenin equivalents", first-year audience.

```yaml
teaching_arc:
  kind: concept
  central_question: What is a Thevenin equivalent?
  moves:
    - { move: establish, idea: "The maximum power transfer theorem says the load should match R_th." }
    - { move: define,    idea: "R_th is the resistance seen at the terminals with sources zeroed." }
    - { move: define,    idea: "V_th is the open-circuit terminal voltage." }
    - { move: apply,     idea: "The three steps: remove load, zero sources, reduce." }
    - { move: exemplify, idea: "12 V in series with 4 Ω, 12 Ω across the terminals gives 9 V and 3 Ω." }
    - { move: establish, idea: "Dependent sources are left in place when zeroing." }
  exit_evidence:
    - { check: "Find R_th for a given network.", level: recall }
```

**Reorder test.** Swap moves 2 and 3: nothing changes — neither definition uses the other. Move 1 (maximum power transfer) can go last, or be deleted, without any other move losing its footing. Move 6 can sit anywhere after move 2. Only "example after the procedure" is a real dependency. Five of six moves are freely permutable → this is a content list. **Rejected.** Note also that the `central_question` ("What is…") asks for a definition, so nothing in the arc has to be *explained*; and the exit evidence tests a procedure the arc never motivates.

## Rebuilt from the relations

Relations recovered in Phase 1 for this topic: *application* — a network is replaced so a load question can be answered once; *definitional* — "equivalent" means identical terminal V–I behaviour; *derivational* — V_th follows from equivalence with no load (open circuit); *derivational* — R_th follows from equivalence with sources zeroed (a zeroed source contributes no excitation, only its resistance); *qualifying* — dependent sources stay because they are part of the network's own response; *contrastive* — adding the resistors as if in series is the common error, and it is the source-still-in-place mistake.

```yaml
teaching_arc:
  kind: derivation
  central_question: Why can any linear two-terminal network be replaced by one source and one resistance — and how do you find them?
  entry_state:
    assumed: [Ohm's law, series/parallel reduction, ideal source models]
    activate_briefly: [what "linear" means for a network]
    teach_first: []
  moves:
    - { move: establish,  purpose: orient,             idea: "A network feeding a load is re-solved for every load unless it can be replaced by something simpler as seen from the terminals.", relation_to_previous: null }
    - { move: define,     purpose: define,             idea: "'Equivalent' means identical terminal voltage–current behaviour for every load.", relation_to_previous: "names the property the replacement must preserve" }
    - { move: derive,     purpose: derive,             idea: "With no load, the terminal voltage of the equivalent is V_th, so V_th is the network's open-circuit voltage.", relation_to_previous: "applies the equivalence with the load removed" }
    - { move: derive,     purpose: derive,             idea: "With independent sources zeroed, the equivalent shows only R_th, so R_th is the resistance seen from the terminals with sources zeroed; dependent sources stay because they are part of the network's own response.", relation_to_previous: "applies the equivalence with the excitation removed" }
    - { move: contrast,   purpose: contrast,           idea: "Adding the resistances as if in series is what happens when the source is left in place; zeroing it turns the pair parallel.", relation_to_previous: "the discriminating error against the previous move" }
    - { move: apply,      purpose: apply,              idea: "12 V in series with 4 Ω, 12 Ω across the terminals: V_th = 9 V, R_th = 4 ∥ 12 = 3 Ω.", relation_to_previous: "instantiates moves 3–5" }
  example_sequence:
    - { function: worked, description: "12 V / 4 Ω / 12 Ω network" }
    - { function: faded, description: "6 V / 2 Ω / 3 Ω, learner computes R_th" }
    - { function: transfer, description: "current-source network — zeroing gives an open" }
  exit_model: Equivalent = same terminal V–I; V_th = open-circuit voltage; R_th = resistance seen with independent sources zeroed.
  exit_evidence:
    - { check: "Explain why zeroing a voltage source means shorting it.", level: recall }
    - { check: "Find R_th for a network with a current source in parallel with a resistor, then a series resistor to the terminal.", level: far_transfer }
```

**Reorder test on the rebuild.** Move 3 cannot precede move 2 (it applies the definition); move 4 cannot precede 2; move 5 cannot precede 4 (it contrasts against it); move 6 cannot precede 3–5. Only the order of moves 3 and 4 is free, and swapping them changes the narrative (voltage first vs. resistance first) — that is a legitimate authoring choice, not a sign of a list. **Accepted.**
