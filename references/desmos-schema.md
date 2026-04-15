# Desmos State Schema Reference

Read this when authoring any `<DesmosGraph state={...}/>` embed in lesson JSX OR when reviewing a `<<DESMOS>>...<<END_DESMOS>>` emission for correctness. The schema is the single most error-prone part of a Desmos integration because of a type footgun the Desmos runtime does not document clearly.

## The string-vs-number footgun (read first)

Desmos `setState` crashes silently with the error

```
parse can only be called with strings, got <n> of type number
```

when certain fields arrive as JS numbers instead of JSON / LaTeX strings. The crash produces a blank canvas plus a `requestAnimationFrame` error spam in the browser console, and NO on-screen indication of what went wrong. The client-side validator in `_lesson-core/chat/processResponse.js` rejects the cases it knows about and returns an `[OBSERVATION]` naming the exact offending path (e.g. `expressions[2].sliderBounds.step must be a STRING`). Lesson-author embeds bypass that validator entirely, so authors must internalize the rule themselves.

## Fields typed as STRINGS (not numbers)

Even though these feel numeric, pass them as JSON strings like `"0.1"`:

- `sliderBounds.min`, `sliderBounds.max`, `sliderBounds.step`
- `lineWidth`, `lineOpacity`, `pointSize`, `pointOpacity`
- `parametricDomain.min`, `parametricDomain.max`
- `polarDomain.min`, `polarDomain.max`
- `latex`, `id`, `color` (hex like `"#c8a45a"`)

## Fields typed as NUMBERS

- `graph.viewport.xmin`, `graph.viewport.xmax`, `graph.viewport.ymin`, `graph.viewport.ymax`

These four are the only numeric fields in the common-case state object. Everything else that feels numeric is a string.

## Enums and optional booleans

- `lineStyle`: `"SOLID"` | `"DASHED"` | `"DOTTED"`
- `type`: typically `"expression"` for function / slider rows
- `hidden`: `true` to hide the curve without deleting the expression
- `showLabel`: `true` to render a text label next to the curve
- `secret`: `true` to hide the expression from the collapsed panel

## Size and shape caps

Enforced by the chat-path validator and recommended for lesson authoring:

- 100 expressions per `expressions.list`
- 3 `<<DESMOS>>` blocks per chat message (does not apply to lesson-author embeds, but a good north star)
- 16 KB serialized state per block
- 1024 chars per `latex` string
- 64 chars per `id`

## LaTeX escaping in JSON source

Backslashes double in JSON, so the raw latex `\sin` becomes `"\\sin"` in the JSON source, and inside a JS template literal or a system-prompt example it becomes `\\\\sin`. Common targets: `\\\\sin`, `\\\\cos`, `\\\\tan`, `\\\\frac{a}{b}`, `\\\\pi`, `\\\\sqrt{x}`, `e^{sx}` (no backslash in `e^{}`).

## Canonical example

The reference the chat system prompt uses:

```json
{
  "version": 11,
  "graph": { "viewport": { "xmin": -5, "xmax": 5, "ymin": -3, "ymax": 3 } },
  "expressions": {
    "list": [
      { "id": "a",   "type": "expression", "latex": "a=1",        "sliderBounds": { "min": "0", "max": "3", "step": "0.1" } },
      { "id": "f",   "type": "expression", "latex": "y=a\\sin(x)","color": "#c8a45a", "lineWidth": "2.5" },
      { "id": "env", "type": "expression", "latex": "y=a",        "color": "#888888", "lineStyle": "DASHED", "lineWidth": "1.5" }
    ]
  }
}
```

In a JS/JSX lesson file (no JSON source, just an object literal), drop one level of backslash escaping: `"y=a\\sin(x)"` in JSON source becomes `"y=a\\\\sin(x)"` in a JS string literal if the string has been serialized through JSON at some point, or plain `"y=a\\sin(x)"` if it is a raw object literal fed directly to `<DesmosGraph state={...}/>`. The safest default for lesson authors is to write the state as a JS object literal with single-backslash latex, never as a JSON.parse of a string.

## Animation and the play button

The chatbot strips `isPlaying: true` from any incoming state. Animation is always student-initiated. There are two play-button UIs in the codebase:

- `ChatBubble.jsx` (chat path): **no overlay**. Students click the native Desmos per-slider Play button inside the expression panel. Panel opens with `expressionsCollapsed: true` in chat embeds, so the student taps the panel toggle first.
- `DesmosGraph.jsx` (lesson path): keeps a small overlay Play button in the top-right that toggles `isPlaying` on every slider at once. Redundant with Desmos's native per-slider button when the panel is visible (`expressionsCollapsed: false` is the lesson default), but not harmful. Remove if it clutters a specific lesson.

Do not author `isPlaying: true` in a lesson-embedded state either — the strip in `DesmosGraph.jsx`'s `stripAutoplay` will silently remove it and you will be confused why the animation did not start.

## Validator observation contract

When the chat-path validator rejects a `<<DESMOS>>` block, the `[OBSERVATION]` carries a reason string with the exact offending path:

```
[OBSERVATION] desmos-lint: expressions[2].sliderBounds.step must be a STRING
              (e.g. "0.1" not 0.1) -- Desmos setState rejects numeric bounds
[/OBSERVATION]
```

The system prompt instructs the bot to "fix exactly what the observation names and re-emit." If you are adding your own validation to a lesson (e.g. for user-facing forms that build a Desmos state), emit reasons with the same path-specific shape so the bot (or the author debugging) can jump straight to the bad field.

## Troubleshooting flowchart

Symptom → likely cause:

- **Blank canvas, no error on screen** → string-vs-number footgun. Check DevTools console for `"parse can only be called with strings"` and walk the list above.
- **Expression panel empty even though `expressions.list` has entries** → missing `type: "expression"` on list items, or `latex` is not a string.
- **Calculator remounts on every parent render** → `state` prop is a fresh object literal every render. Wrap in `useMemo` or hoist outside the component.
- **Slider does not animate on click** → `isPlaying` was stripped upstream (correct) and the student has not clicked the native Play button. The bot is forbidden from auto-starting animation.
- **Red "Desmos key not configured" box** → `VITE_DESMOS_KEY` missing from the lesson's `.env.local`. See `references/phase-3-execution.md` step 6.
