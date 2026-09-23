# Thread-spend evidence

Proof that each reply-thread's running dollar total — and the main conversation's own, added
after a landing review caught it missing (2026-09-23) — is summed correctly off the hosted
tutor's SSE `"done"` events, that a `done` with no cost shows nothing rather than `$0.00`, and
that `Chatbot.jsx`/`ThreadPanel.jsx` are wired to the pieces this checks directly.

```
node tests/thread-spend/check.cjs
```

`chat.py` puts `"cost"` (`total_cost_usd`) on every `done` event. Its own book-keeping
(`Book.tokens["cost"] += parsed.get("total_cost_usd")`) sums that figure per turn, because each
turn is a fresh `--resume`d CLI process rather than one process held open for the whole
session — the number it reports is that turn's own cost, not a running total for the session.
`chatState.js`'s `addSpend` sums the same way. This is not directly observable from this repo
(chat.py lives in the iiks1 box's own tree), so it is inferred from that accumulator rather than
measured against a live proxy — noted here so a later change to chat.py's accounting is the
place to recheck it.

## What `check.cjs` asserts

| | Scenario | Must hold |
| --- | --- | --- |
| 1 | `turnStream.js`'s `readTurn` on a `done` event carrying `cost` | `turn.cost` is that value; the reply text is unaffected |
| 2 | a `done` with no `cost` field, or an explicit `null` | `turn.cost` stays `undefined` — never coerced to `0` |
| 3 | `chatState.js`'s `addSpend`, called once per turn | sums (a turn's cost is added to the running total, not a replacement of it), including a sub-cent turn |
| 4 | `addSpend` given `undefined`/`null`/`NaN`/a string instead of a number | the running total is returned unchanged, whatever it was |
| 5 | `chatState.js`'s `fmtSpend` | two decimals at or above a cent, four below it (so a few sub-cent turns don't all read as `$0.00`), and `""` for anything that isn't a number yet |
| 6 | `Chatbot.jsx`'s thread SSE loop (its own reader — threads don't use `turnStream.js`'s attach/reattach) | reads `data.cost` off its own `done` event into `turnCost`, folds it into the finished thread record with `addSpend(th.spend, turnCost)`, both thread-creation sites seed `spend: undefined`, and the save effect's `{ ...t, ... }` spread keeps `spend` in what a reload restores |
| 7 | `ThreadPanel.jsx` | imports `fmtSpend`, renders the total only when `thread.spend` is actually a number, through `fmtSpend` |
| 8 | `Chatbot.jsx`'s MAIN conversation (the tab itself, not a side-thread) | `applyReply` — shared by a sent message and a turn picked back up by attach — takes this turn's `cost` and folds it into the tab with `addSpend`; both call sites pull `cost` off `readTurnWithReattach` and pass it through; a new tab seeds `spend: undefined`; the chat header shows it through `fmtSpend`, only once `activeTab.spend` is actually a number |

No fixture drives a live proxy here — `tests/hosted-build` and a manual build are what confirm
the built bundle actually carries this wiring end to end.
