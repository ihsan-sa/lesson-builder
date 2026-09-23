# Tutor-defaults evidence

Proof that a freshly opened tutor chat starts on `claude-opus-5-5` at `medium` effort, and that
the rest of the picker — Opus 5 included — is still offered.

```
node tests/tutor-defaults/check.cjs
```

Reads `_lesson-core/constants/models.js` directly (the single source of truth
`Chatbot.jsx` seeds a new chat's `model`/`effort` state from), and reads `Chatbot.jsx` /
`server/proxy.js` as text for the wiring. No browser: proving what a built lesson's
`/session/init` and `/chat` calls carry on a fresh chat means proving the state they're built
from starts there, which is exactly what `DEFAULT_MODEL`/`DEFAULT_EFFORT` are for
(`Chatbot.jsx`'s `useState(DEFAULT_MODEL)` / `useState(DEFAULT_EFFORT)`, and the `reqBody` a
sent message posts to `/chat` carries that same `model`/`effort` state unchanged).

## What `check.cjs` asserts

| | Scenario | Must hold |
| --- | --- | --- |
| 1 | `MODELS`/`DEFAULT_MODEL`/`DEFAULT_EFFORT` | `DEFAULT_MODEL` is `claude-opus-5-5`, `DEFAULT_EFFORT` is `medium`, exactly one `MODELS` entry carries `default: true` and it is the Opus 5.5 one |
| 2 | the rest of the picker | all six models are present (the five pre-existing ones plus the new default); Opus 5 itself no longer carries `default: true` |
| 3 | shortcut keys | every model has a unique, single-character key; none of them is `j` or `g` (reserved by Chatbot's own Ctrl+Shift+J/G gestures); Opus 5.5 got a key of its own rather than reusing Opus 5's `o` |
| 4 | effort levels | `EFFORT_LEVELS` still lists all five (`xhigh` stays offered, just not the default); `server/proxy.js`'s `SAFE_EFFORTS` allowlist is still the same set |
| 5 | `Chatbot.jsx` wiring | imports `DEFAULT_MODEL`/`DEFAULT_EFFORT` from `models.js`; `model`/`effort` state is seeded from them; a sent message's `reqBody` carries that same `model`/`effort` state to `/chat` unchanged |

`tests/hosted-build` (already in the gate) is the closest thing to a live check without a
proxy: building the demo lesson with `VITE_TUTOR=1` and grepping the bundle for
`claude-opus-5-5` and `"medium"` confirms the constant actually reaches the compiled client.
