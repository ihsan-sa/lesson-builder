# Lesson augmentation: `<<SUGGEST>>` and `<<DEMO>>` tag protocols

The tutor uses these two tag protocols to (a) propose permanent additions to the lesson file and (b) show ephemeral inline visual explanations in the chat bubble. Read this reference on demand when you are about to emit either tag.

## When to use which

- **`EDIT_GRAPH`** (documented elsewhere): modify an existing lesson graph in place.
- **`<<SUGGEST>>`**: propose a permanent addition to the lesson JSX file. User must approve before the client edits the file.
- **`<<DEMO>>`**: show a one-off inline visual in the chat bubble. Not persisted to the lesson.

Rule of thumb: if the student asks a question whose answer belongs in the lesson for future readers, use `SUGGEST`. If the answer is for this student right now, use `DEMO`. If the student wants to change an existing graph, use `EDIT_GRAPH`.

## `<<SUGGEST>>` tag syntax

```
<<SUGGEST type="lesson|faq" section="exact-section-title" title="Short Title" mode="inline|collapsible">>
[JSX body]
<<END_SUGGEST>>
```

### Attributes

- `type="lesson"`: add to a specific section of the lesson body.
- `type="faq"`: add to the FAQ collection (no `section` needed).
- `section`: must match an existing section title in the lesson **exactly**. If you are unsure, read the lesson file first. A mismatch will be rejected by the user.
- `title`: short title shown in the approval UI and as the heading of the added block.
- `mode="inline"`: short addition (1 to 3 lines). Renders directly in the section.
- `mode="collapsible"`: longer passage. Wraps in a `<CollapsibleBlock>` automatically.

### Body: available JSX components

All imported from `@core`. Use only these in the body:

- `<P>...</P>`: paragraph.
- `<Eq>{"\\int_0^1 x^2\\,dx"}</Eq>`: display math equation (KaTeX string as the CHILD, not a prop).
- `<M>{"\\hbar"}</M>`: inline math.
- `<KeyConcept label="Short label">...</KeyConcept>`: highlighted callout.
- `<CollapsibleBlock title="...">...</CollapsibleBlock>`: expandable passage.
- inline `<svg viewBox="...">...</svg>`: small static diagrams.

### KaTeX formatting rule

Inside any KaTeX string (the string child of `<Eq>` or `<M>`), use `\\lt` and `\\gt` instead of bare `<` and `>`. Bare angle brackets break the JSX parser. Use dollar delimiters only in plain text, never inside the `{"..."}` child.

### Approval flow

1. Tutor emits one `<<SUGGEST>>` block.
2. Client renders the block with 3 buttons: **Add to lesson**, **Add to FAQ**, **No**.
3. On approval, the client edits the lesson JSX file directly, inserting the body at the right location.
4. On rejection, the block is discarded; tutor receives an observation.

### Constraints

- **Only one SUGGEST block per turn**. If you want to propose multiple additions, chain them across turns.
- No imports inside the body. The client wires imports from `@core`.
- No state, no hooks, no event handlers. The body is static JSX.
- Keep the body focused: one idea per SUGGEST.

## `<<DEMO>>` tag syntax

```
<<DEMO title="Short Title">>
<svg viewBox="0 0 W H" style="width:100%;max-width:Wpx;display:block;margin:8px auto">
  <!-- use gold #c8a45a, blue #4a90d9, red #e06c75, green #69b578 -->
  <!-- include labeled axes and clear annotations -->
</svg>
<<END_DEMO>>
```

### Purpose

Inline visual explanation inside the chat bubble. Ephemeral: not persisted, not added to the lesson file. Good for "draw me the wavefunction for n=3" or "show the force diagram for this specific case".

### SVG requirements

- Root element must be `<svg>` with a `viewBox` attribute.
- Must parse as valid XML.
- Use the lesson palette: gold `#c8a45a`, blue `#4a90d9`, red `#e06c75`, green `#69b578`. Text should be light on the dark chat background; use `#e8e6e3` or `#c8a45a` for labels.
- Include labeled axes where applicable. Annotate any feature the student should notice.
- Responsive sizing: `width:100%;max-width:Wpx;display:block;margin:8px auto` in the `style` attribute.

### Client linting

The client lints the SVG before rendering:

- Must have `<svg>` root.
- Must have `viewBox` attribute.
- Must parse as valid XML (no unclosed tags, no bad entities).

Malformed SVG is rejected with an observation like `"SVG lint: missing viewBox"`. Fix and re-emit in the next turn.

### Constraints

- **One DEMO per turn**.
- No JavaScript, no event handlers, no external references. Static SVG only.
- Keep SVGs small: viewBox under 800x600 is usually enough for a chat bubble.
- Do not use DEMO for long-lived explanations. Use SUGGEST for those.
