# Custom-property evidence for the lessons' stylesheet

Proof that every `var(--x)` in `references/bootstrap/_lesson-core/chat/chat.css.js` resolves in both
themes, and that the sheet still parses as the JS template literal it is.

```
node tests/css-vars-defined/check.cjs     # or ./check.cjs
```

Node only. No `npm install`, no network, no browser: the sheet is text, and each case parses the text
it is about. Runs in well under a second. Exit code 0 only when every check passes.

A custom property resolves **where it is declared**, not where it is used. `--ink: var(--text-primary)`
declared only under `:root, .theme-dark` computes against the dark palette, and that computed value
inherits into a `.theme-light` subtree — so the light theme silently paints dark, and nothing in the
CSS looks wrong. "Defined" therefore means declared in *both* theme blocks, or declared on the very
rule that uses it, which is how `.chat-panel-expanded` carries its own `--chat-content-w`.

This fixture exists because the sheet was restored by taking the lessons' original stylesheet and
appending newer rules that had been written against a different palette. Those rules arrived asking
for twelve tokens the original never declared — `--ink`, `--canvas`, `--surface`, `--ease` and the
rest — and a `var()` that resolves to nothing paints as if the property were never set: the equation
Explain button, the chat panel and the KaTeX-loading splash all came up unstyled rather than broken,
which is the kind of regression that ships.

## What `check.cjs` asserts

| | Case | Must hold |
|-|------|-----------|
| 1 | the analyser, on fixtures of its own | flags a var declared in neither theme; flags one declared in only one theme, naming which; does **not** flag one declared in both, nor one declared on the rule that uses it; reaches inside `@media` and `@keyframes`; does not read a declaration inside a comment as a definition |
| 2 | the shipped sheet | every `var(--x)` resolves in both themes, and the twelve forward-ported tokens are declared in each theme block by name |
| 3 | the sheet as JavaScript | exactly two backticks (the pair delimiting `STYLES`), no `${` interpolation, balanced braces, `STYLES` exported |

Case 1 builds every fixture it asserts on, and pins down what the analyser lets through as well as
what it catches — an analyser that flags everything would pass a test that only checked for flags.

Case 3 is about a build, not a look: these sheets are JS template literals, so one backtick anywhere
in the CSS — a comment included — ends the literal early and the build fails with
`Expected a semicolon`. That has cost a build once.
