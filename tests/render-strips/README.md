# render-strips — what a tutor reply may do before it renders

Proof that model text reaching a chat bubble is stripped the way `_lesson-core/chat/` says, and
that its action tags act only where they should.

```
node tests/render-strips/check.cjs
```

Node only: no npm install, no network, no browser. It runs the production path
(`processResponse` -> `renderChatHtml` -> `stripActiveContent` -> `sanitizeHtml`) on
`minidom.cjs`, a fake DOM just big enough for these modules. Parser quirks and mutation-XSS need a
real parser, so they stay with `tests/safe-render`, which runs the same modules in Chromium.

## What it asserts

`corpus.cjs` states, per case, the exact rendered HTML and the exact set of things the reply
dispatched: graph edits, suggestion, commit offer, reinforced behaviours and observations.

| kind | cases |
| --- | --- |
| reply | live tags act (the controls); the same tags in a code fence, inline code or a `>` quote line do nothing and render as text; nested, malformed and unterminated tags; look-alike tags (fullwidth, Cyrillic, zero-width, lower case); side-thread scope; Desmos payload rules; handlers, `javascript:` URLs and denied elements in markdown, `<<SOURCES>>`, `<<DEMO>>` and raw SVG |
| stream | a half-arrived tag is hidden while the reply streams |
| layer1 | the regex pre-filter on its own |
| layer2 | the allowlist rebuild on its own, with the reason it recorded for each drop |

Every rendered output also passes an oracle: no denied element, no `on*` attribute and no URL
outside its allowed schemes.

Then it removes each protection listed in `MUTATIONS` from a copy of the modules and requires at
least one case to go red. A mutation whose source text is no longer in the module fails the
check, so the list cannot go stale unnoticed.

One case records a known over-strip rather than a hole: layer 1 runs on the whole HTML string,
so it also cuts handler text out of an escaped code sample.
