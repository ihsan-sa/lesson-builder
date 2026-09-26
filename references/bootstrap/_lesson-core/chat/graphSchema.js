const SCHEMA_TYPES = ["int", "float", "bool", "enum", "string"];

/**
 * What is wrong with one GRAPH_SCHEMA field spec, or null when it keeps the contract
 * (references/graph-schema-guide.md): an object whose `type` is one of SCHEMA_TYPES, and for
 * an enum a non-empty `values` array. `options:` is not an alias for `values:`; a field that
 * uses it is malformed, so the chat skips it rather than guessing.
 * @returns {string|null}
 */
export function schemaFieldProblem(spec) {
  if (!spec || typeof spec !== "object") return "spec is not an object";
  if (!SCHEMA_TYPES.includes(spec.type)) return `unknown type '${spec.type}' (expected ${SCHEMA_TYPES.join(" | ")})`;
  if (spec.type === "enum" && (!Array.isArray(spec.values) || spec.values.length === 0)) {
    return "enum" + (spec.options !== undefined ? " uses options:, but the key is values:" : " has no non-empty values array");
  }
  return null;
}

/**
 * Every field of a GRAPH_SCHEMA that breaks the contract. test_lesson.cjs fails a lesson on any.
 * @returns {Array<{graphKey: string|null, param: string|null, reason: string}>}
 */
export function schemaProblems(schema) {
  if (!schema || typeof schema !== "object") return [{ graphKey: null, param: null, reason: "GRAPH_SCHEMA is not an object" }];
  const problems = [];
  for (const [graphKey, params] of Object.entries(schema)) {
    if (!params || typeof params !== "object") {
      problems.push({ graphKey, param: null, reason: "entry is not an object of param specs" });
      continue;
    }
    for (const [param, spec] of Object.entries(params)) {
      const reason = schemaFieldProblem(spec);
      if (reason) problems.push({ graphKey, param, reason });
    }
  }
  return problems;
}

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
      const problem = schemaFieldProblem(spec);
      if (problem) {
        errors.push({ graphKey, param, reason: `the lesson's schema for this field is malformed (${problem}); it cannot be edited` });
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
