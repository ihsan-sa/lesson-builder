# `<<EDIT_GRAPH>>` tag protocol

Reference for the tutor on how to emit lesson graph edits. Read this on demand before emitting an `EDIT_GRAPH` block.

## Tag syntax

```
<<EDIT_GRAPH>>{"graphKey": {"param": value}}<<END_EDIT>>
```

The payload between the tags is strict JSON. The client parses it, validates every field against the lesson's `GRAPH_SCHEMA`, applies the valid subset, and returns any errors as an `[OBSERVATION]` block on the next tutor turn.

## Schema shape

Every lesson that supports graph edits exports a `GRAPH_SCHEMA` object:

```js
{
  graphKey: {
    param: { type: 'int' | 'float' | 'bool' | 'enum', min?: number, max?: number, values?: any[] }
  }
}
```

- `type: 'int'` and `type: 'float'` honor `min` and `max` (inclusive).
- `type: 'bool'` accepts `true` or `false` only.
- `type: 'enum'` accepts any value in the `values` array.

The schema for the active lesson is passed into your context block each turn. Do not guess keys or parameters.

## Rules

- **Valid graph keys come from the active context block.** Never invent a key.
- **Valid parameter names come from the schema in the active context.** Never invent a parameter.
- **Values must match the declared type and range.** Out-of-range values are rejected.
- **One `<<EDIT_GRAPH>>` block per turn.** A single block may contain multiple `graphKey` entries, but do not emit two separate `<<EDIT_GRAPH>>` blocks in one response.

## Examples

**Valid**
```
<<EDIT_GRAPH>>{"infiniteWellWavefunctions": {"nMax": 3}}<<END_EDIT>>
```
Assuming the schema declares `infiniteWellWavefunctions.nMax` as `{ type: 'int', min: 1, max: 6 }`, this applies cleanly and the next turn receives an `[OBSERVATION]` confirming success.

**Valid multi-key**
```
<<EDIT_GRAPH>>{"infiniteWellWavefunctions": {"nMax": 4}, "probabilityDensity": {"showClassical": true}}<<END_EDIT>>
```
Two graphs updated in one block. Both must validate independently.

**Invalid: out of range**
```
<<EDIT_GRAPH>>{"infiniteWellWavefunctions": {"nMax": 99}}<<END_EDIT>>
```
Observation returns something like: `nMax=99 above max 6`. Correct the value and re-emit on the next turn.

**Invalid: unknown key**
```
<<EDIT_GRAPH>>{"doesNotExist": {"x": 1}}<<END_EDIT>>
```
Observation returns: `unknown graphKey "doesNotExist"`. Check the context block for the actual keys.

**Invalid: unknown parameter**
```
<<EDIT_GRAPH>>{"infiniteWellWavefunctions": {"colorMode": "rainbow"}}<<END_EDIT>>
```
Observation returns: `unknown parameter "colorMode" on infiniteWellWavefunctions`.

## When to emit

- The student explicitly asks to change a graph ("show me n up to 5", "turn on the classical overlay").
- A `breakthrough-gap-agent` analysis suggests a graph change would clarify and you have confirmed the parameter exists.

## When NOT to emit

- Speculatively, as in "let me try this and see". The client applies edits for real; speculation wastes a turn and confuses the student.
- For cosmetic tweaks that do not change the pedagogy (color, title text).
- For multiple unrelated graphs in one turn when only one is being discussed.
- Before you have read the schema in the active context block.

## Error recovery loop

1. Emit `<<EDIT_GRAPH>>...<<END_EDIT>>`.
2. Next turn: receive an `[OBSERVATION]` with either success or a list of field-level errors.
3. If errors, correct the specific fields and re-emit. Do not re-emit the full block unchanged.
4. If the same key fails twice, stop and explain to the student in prose; do not loop.
