/**
 * Validate an EDIT_GRAPH payload against a lesson's GRAPH_SCHEMA.
 * @param {object} edits  - e.g. { graphKey: { param: value } }
 * @param {object} schema - e.g. { graphKey: { param: { type, min, max } } }
 * @returns {{ validValue: object, errors: Array<{graphKey: string|null, param: string|null, reason: string}> }}
 */
export function validateEdit(edits, schema) {
  const validValue = {};
  const errors = [];
  if (!edits || typeof edits !== "object") {
    errors.push({ graphKey: null, param: null, reason: "edits payload is not an object" });
    return { validValue, errors };
  }
  if (!schema || typeof schema !== "object") {
    // Fail CLOSED: with no schema there is nothing to validate against, and
    // passing edits through would let the model mutate arbitrary graph state.
    // Legacy lessons without GRAPH_SCHEMA get this observation until the
    // update pipeline backfills their schema.
    errors.push({ graphKey: null, param: null, reason: "this lesson has no GRAPH_SCHEMA — graph edits are disabled until one is added (update pipeline backfills it)" });
    return { validValue, errors };
  }
  for (const [graphKey, paramEdits] of Object.entries(edits)) {
    if (!schema[graphKey]) {
      errors.push({ graphKey, param: null, reason: `unknown graphKey '${graphKey}'. Valid keys: ${Object.keys(schema).join(", ")}` });
      continue;
    }
    const keySchema = schema[graphKey];
    const keyValid = {};
    for (const [param, value] of Object.entries(paramEdits || {})) {
      const spec = keySchema[param];
      if (!spec) {
        errors.push({ graphKey, param, reason: `unknown parameter '${param}'. Valid params for ${graphKey}: ${Object.keys(keySchema).join(", ")}` });
        continue;
      }
      const res = _validateValue(value, spec);
      if (res.ok) keyValid[param] = res.value;
      else errors.push({ graphKey, param, reason: res.reason });
    }
    if (Object.keys(keyValid).length > 0) validValue[graphKey] = keyValid;
  }
  return { validValue, errors };
}

function _validateValue(value, spec) {
  if (spec.type === "int") {
    if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, reason: `expected integer, got ${typeof value}` };
    if (spec.min != null && value < spec.min) return { ok: false, reason: `${value} below min ${spec.min}` };
    if (spec.max != null && value > spec.max) return { ok: false, reason: `${value} above max ${spec.max}` };
    return { ok: true, value };
  }
  if (spec.type === "float") {
    if (typeof value !== "number") return { ok: false, reason: `expected number, got ${typeof value}` };
    if (spec.min != null && value < spec.min) return { ok: false, reason: `${value} below min ${spec.min}` };
    if (spec.max != null && value > spec.max) return { ok: false, reason: `${value} above max ${spec.max}` };
    return { ok: true, value };
  }
  if (spec.type === "bool") {
    if (typeof value !== "boolean") return { ok: false, reason: `expected boolean, got ${typeof value}` };
    return { ok: true, value };
  }
  if (spec.type === "enum") {
    if (!Array.isArray(spec.values) || !spec.values.includes(value)) {
      return { ok: false, reason: `'${value}' not in allowed values {${(spec.values || []).join(", ")}}` };
    }
    return { ok: true, value };
  }
  if (spec.type === "string") {
    if (typeof value !== "string") return { ok: false, reason: `expected string, got ${typeof value}` };
    return { ok: true, value };
  }
  return { ok: false, reason: `unknown schema type '${spec.type}'` };
}
