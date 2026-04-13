# GRAPH_SCHEMA derivation guide

## 1. Purpose

`GRAPH_SCHEMA` pairs with `DEFAULT_GRAPH_PARAMS` to give the chatbot runtime type and range info for every tunable parameter. When the LLM emits `<<EDIT_GRAPH>>`, `validateEdit(edits, GRAPH_SCHEMA)` from `_lesson-core/chat/graphSchema.js` rejects type/range/enum violations (LLM gets an `edit-rejection` observation), forwards valid entries through `onEditGraph` into `graphParams` state. A lesson without `GRAPH_SCHEMA` silently bypasses validation — any malformed LLM edit lands in React state and crashes the graph.

Used in two places:

- **New mode — Phase 3 Step 4**: write from scratch after `DEFAULT_GRAPH_PARAMS`.
- **Update mode — Phase 3 Step 4.7 (backfill)**: generate for lessons predating the feature. Detection at Phase 2; key-set invariant enforced by post-splice sanity pass (section 4.6 check 4).

## 2. Canonical shape

The type vocabulary is enforced by `_lesson-core/chat/graphSchema.js`. **Do
not invent new type strings** — the validator hardcodes the five below and
rejects anything else with `unknown schema type '<type>'`.

```ts
GRAPH_SCHEMA: {
  [graphKey: string]: {
    [paramKey: string]: ParamSpec
  }
}

type ParamSpec =
  | { type: "int",    min?: number, max?: number }
  | { type: "float",  min?: number, max?: number }
  | { type: "bool" }
  | { type: "enum",   values: Array<string | number> }
  | { type: "string" }
```

Validator behavior:

- `int`: `Number.isInteger(value)` AND `min <= value <= max`. Non-integers rejected.
- `float`: `typeof value === "number"` AND `min <= value <= max`. No integer coercion.
- `bool`: `typeof value === "boolean"`.
- `enum`: membership in `spec.values`. Key is literally `values` (not `enum`) — `enum` silently fails.
- `string`: `typeof value === "string"`, no patterns.
- `min`/`max` optional. Omit only when truly unbounded.

The validator ignores unknown fields, so `label`/`description`/`step` metadata is safe but not used in deployed lessons. Keep schemas lean.

Valid types: `int | float | bool | enum | string`. `"number"`, `"boolean"`, `"number[]"` fail with `"unknown schema type"`.

### Worked example

```jsx
const DEFAULT_GRAPH_PARAMS = {
  firstGraph:  { nMax: 4, showOverlay: false },
  secondGraph: { nMax: 4 },
  thirdGraph:  { nMax: 6, width: 1.0 },
};

export const GRAPH_SCHEMA = {
  firstGraph: {
    nMax:        { type: "int",  min: 1, max: 6 },
    showOverlay: { type: "bool" },
  },
  secondGraph: {
    nMax: { type: "int", min: 1, max: 6 },
  },
  thirdGraph: {
    nMax:  { type: "int",   min: 1, max: 8 },
    width: { type: "float", min: 0.2, max: 5.0 },
  },
};
```

Observe: `nMax` is `int` because the graph component iterates
`for (let n = 1; n <= nMax; n++)`, and the schema max (`6`) mirrors any
`Math.min(p.nMax, 6)` clamp inside the component. When a graph silently
clamps its input, match the clamp in the schema so the chatbot surfaces a
rejection instead of a silently-clamped value.

## 3. Derivation rules from DEFAULT_GRAPH_PARAMS

### 3.1 Key correspondence (hard invariant)

Every `DEFAULT_GRAPH_PARAMS[graphKey][paramKey]` **must** have a matching `GRAPH_SCHEMA[graphKey][paramKey]`, and nothing else. Enforced by the Phase 3 post-splice sanity pass (section 4.6). The 17-test suite does not currently enforce this; the sanity pass is the backstop.

### 3.2 Type inference from the default value

| Default value                       | Spec type                                          |
|-------------------------------------|----------------------------------------------------|
| Integer literal (`4`, `1`, `8`)     | `int`                                              |
| Non-integer number (`0.026`, `1e-14`) | `float`                                          |
| `true` / `false`                    | `bool`                                             |
| String from a fixed set of choices  | `enum` (supply `values`)                           |
| Free-form string                    | `string`                                           |

`int` vs `float` is the first decision point. If the graph component
indexes arrays or loops `for (let n = 1; n <= p.n; n++)` with the
parameter, it is `int`. If the parameter enters arithmetic (`p.VT * ln(...)`
etc.), it is `float` even when the default happens to be a whole number
like `1.0`.

Arrays of numbers (e.g. `vgsValues: [2, 3, 4, 5]`) are **not** a
first-class schema type. The deployed corpus handles them by exposing
scalar parameters that index into the array, or by leaving the array out
of the schema entirely so the chatbot cannot edit it. Prefer the latter
if the array is structural rather than tunable.

### 3.3 Range inference for int and float

Ranges are judgement calls, not formulas. Use the following in order of
priority:

1. **Respect in-component clamps.** If the graph body contains
   `Math.min(p.foo, K)` or `Math.max(p.foo, K)`, match `K` exactly in the
   schema. The schema is a public contract with the chatbot; a clamp that
   the schema ignores turns rejections into silent data loss.
2. **Physical constants with well-known ranges.** Use literature values:
   saturation current `Is` for silicon diodes `1e-18` to `1e-9`; thermal
   voltage `VT` at reasonable temperatures `0.015` to `0.05` V; MOSFET
   transconductance parameter `kn` `1e-5` to `1e-2` A/V^2; threshold
   voltage `Vth` `0.3` to `3.0` V.
3. **Axis positions / slider parameters.** Match the viewBox x-domain of
   the graph. If the SVG uses `x in [-10, 10]`, the slider parameter
   should use the same bounds.
4. **Ratios, gains, counts of iterations.** Typical bounds: `0.01` to
   `100` for ratios, `1` to `1000` for iteration counts.
5. **Temperatures.** `200` to `400` K for room-temperature physics;
   extend only if the graph actually plots high-temperature behaviour.
6. **Fallback when uncertain.** Use `10x` below and `10x` above the
   default, rounded to a clean decade. Attach a temporary comment above
   the entry (`// TODO: tune range after visual check`) so the Phase 4
   review catches it.

### 3.4 Enums

`enum` requires an explicit `values` array. Examples:

```jsx
// a CPU-instruction visualization
instruction: { type: "enum", values: ["add", "lw", "sw", "beq", "jal"] }

// a forcing-function selector for an ODE solver
forcing: { type: "enum", values: ["polynomial", "exponential", "trig"] }
```

The allowed list must exactly match the set of branches the graph
component can render. If the component has a `switch (p.mode)` with five
cases, the enum has five values — no more, no less.

### 3.5 Booleans

Always bare: `{ type: "bool" }`. No min, max, or description.

## 4. Worked backfill example (update mode)

**Input** — an existing lesson has no `GRAPH_SCHEMA` export. Suppose its
`DEFAULT_GRAPH_PARAMS` looks like:

```jsx
const DEFAULT_GRAPH_PARAMS = {
  exampleFloat: { Is: 1e-14, VT: 0.026 },
  exampleInt:   { kn: 0.001, Vth: 1.0, W: 10, L: 1 },
};
```

**Output** — generated during Phase 3 Step 4.7, inserted immediately
after the `DEFAULT_GRAPH_PARAMS` block:

```jsx
export const GRAPH_SCHEMA = {
  exampleFloat: {
    Is: { type: "float", min: 1e-18, max: 1e-9 },
    VT: { type: "float", min: 0.018, max: 0.035 },
  },
  exampleInt: {
    kn:  { type: "float", min: 1e-5, max: 1e-2 },
    Vth: { type: "float", min: 0.3,  max: 3.0 },
    W:   { type: "int",   min: 1,    max: 100 },
    L:   { type: "int",   min: 1,    max: 10  },
  },
};
```

Reasoning trace (for a physics/electronics lesson where these parameters
represent a diode saturation current, thermal voltage, and MOSFET
dimensions):

- `Is` — literature bound for the physical quantity (here, silicon
  saturation current): `1e-18` to `1e-9`. `float` because it is a
  real-valued arithmetic input.
- `VT` — thermal voltage `kT/q`. Room-temperature range `0.018` to
  `0.035` V covers ~210 K to ~400 K.
- `kn` — transconductance parameter. Literature bound `1e-5` to `1e-2` A/V^2.
- `Vth` — threshold voltage. Typical range `0.3` to `3.0` V.
- `W`, `L` — channel dimensions. The default values (`10`, `1`) are
  integers and channel geometry is conventionally given in whole micron
  multiples at the level lessons target, so `int`. Bounds are a rounded
  `~10x` envelope around the default.

Substitute the ranges appropriate to the lesson's actual domain. If any of
these ranges is an uncertain guess rather than a literature value, add
`description: "range is a guess, tune after testing"` to the spec so the
Phase 4 review and the user can find it easily. The runtime validator
ignores `description`.

## 5. Validation

After writing `GRAPH_SCHEMA`, main Claude runs these checks as part of the Phase 3 post-splice sanity pass (section 4.6):

1. **Top-level key count**:
   `Object.keys(GRAPH_SCHEMA).length === Object.keys(DEFAULT_GRAPH_PARAMS).length`.
2. **Per-graph key set**: for each `graphKey in DEFAULT_GRAPH_PARAMS`,
   `Object.keys(DEFAULT_GRAPH_PARAMS[graphKey])` must equal
   `Object.keys(GRAPH_SCHEMA[graphKey])` as sets.
3. **Type vocabulary**: every `spec.type` is one of
   `int | float | bool | enum | string`.
4. **Enum specs have `values`**: every enum entry has a non-empty
   `values` array.
5. **Babel parse of the whole file** still succeeds (catches stray
   trailing commas and bracket mismatches from a hand-written schema).

A failure on any check halts Phase 3 before Phase 4 runs and is logged
under `Drift repairs:` in `lesson_build.log.md` with the failure reason.

## 6. Update-mode backfill procedure (main Claude)

1. **Detection** — during the Phase 1 existing-media inventory pre-scan,
   grep the lesson file for a `GRAPH_SCHEMA` export:

   ```
   grep -n "const GRAPH_SCHEMA\|export const GRAPH_SCHEMA\|GRAPH_SCHEMA =" src/<slug>.jsx
   ```

   Absent means the lesson predates the graph-schema feature.
2. **Surface at the approval gate** — Phase 2 writes
   `STRUCTURAL DRIFT REPAIRS: GRAPH_SCHEMA backfill: needed` in the
   change-list. See `references/phase-2-plan.md` line ~212 for the exact
   wording.
3. **Generate** — during Phase 3 assembly, build `GRAPH_SCHEMA` from the
   current `DEFAULT_GRAPH_PARAMS` using the rules in section 3 above.
   Walk each graph component body to catch silent clamps (section 3.3
   rule 1) and enum branch lists (section 3.4).
4. **Insert** — splice the new export immediately after the
   `DEFAULT_GRAPH_PARAMS` block in the lesson file. Use the anchor
   pattern from `references/phase-3-execution.md` section 4.6:
   `const DEFAULT_GRAPH_PARAMS = \{ ... \};` closing brace.
5. **Reconcile Chatbot props** — confirm the `<Chatbot ... />` JSX
   passes `graphSchema={GRAPH_SCHEMA}`. If the prop is missing (common
   on pre-Phase-A lessons), add it as a second drift-repair item.
6. **Validate** — run the section 5 checks. Halt on any failure.
7. **Log** — under `### Phase 3 — Execution (update)`, add a
   `Drift repairs:` line that includes `GRAPH_SCHEMA backfill` (and
   `Chatbot props reconcile` if applicable).

If a param's range is uncertain, include
`description: "range is a guess, tune after testing"` on that spec so
it is easy to find in a follow-up pass.

## 7. How the chatbot uses GRAPH_SCHEMA at runtime

The wiring path, end to end:

1. The lesson file passes `graphSchema={GRAPH_SCHEMA}` as a prop to
   `<Chatbot>` (from `@core/chat`).
2. `Chatbot.jsx` holds the schema in a closure and forwards it to
   `processResponse` on every assistant turn. It also forwards it to
   `buildActiveContext` so the system prompt can enumerate editable
   parameters and their bounds — the LLM is told **up front** which
   knobs it may turn.
3. When the LLM emits `<<EDIT_GRAPH>>{ ... }<<END_EDIT>>`,
   `processResponse.js` calls `validateEdit(edits, graphSchema)` from
   `_lesson-core/chat/graphSchema.js`.
4. For each `(graphKey, param, value)` triple, `validateEdit`:
   - rejects unknown `graphKey` with `"unknown graphKey '<key>'. Valid
     keys: <list>"`;
   - rejects unknown `param` with `"unknown parameter '<param>'. Valid
     params for <graphKey>: <list>"`;
   - dispatches to `_validateValue` by `spec.type` and returns the
     per-type rejection reason on failure.
5. Valid entries are collected into `validValue`; rejections are
   collected into `errors` and passed through the `edit-rejection`
   observation so the LLM sees them on its next turn and can retry.
6. `validValue` is passed to `onEditGraph` in the lesson, which merges
   it into the `graphParams` state via `setGraphParams`, and the graph
   re-renders with the new values.

A missing `GRAPH_SCHEMA` short-circuits step 4 — `validateEdit` returns `{ validValue: edits, errors: [] }` unchecked, and arbitrary LLM output lands in React state. This guide exists to prevent that.
