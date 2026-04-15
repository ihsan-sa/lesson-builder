/**
 * Build the per-turn active-context block prepended to each user message.
 * Contains the current tab topic, live graph state, schema ranges,
 * isolation mode, and the session-accumulated REINFORCED BEHAVIORS list
 * (media/approaches that produced positive signals earlier in the chat).
 * Keeps the standing system prompt lean.
 */
export function buildActiveContext({ tabId, topicTitle, topicText, graphParams, graphSchema, isolated, reinforced = [] }) {
  const lines = ["[ACTIVE CONTEXT]"];
  if (tabId) lines.push(`Tab: ${tabId}`);
  if (topicTitle) lines.push(`Title: ${topicTitle}`);
  if (topicText) lines.push(`Topic: ${topicText}`);
  if (graphParams && Object.keys(graphParams).length > 0) {
    lines.push(`Graph state: ${JSON.stringify(graphParams)}`);
    if (graphSchema) {
      const ranges = [];
      for (const [key, params] of Object.entries(graphSchema)) {
        const parts = Object.entries(params).map(([p, spec]) => {
          if (spec.type === "int" || spec.type === "float") {
            return `${p} in [${spec.min}, ${spec.max}]`;
          } else if (spec.type === "bool") {
            return `${p} in {true, false}`;
          } else if (spec.type === "enum") {
            return `${p} in {${spec.values.join(", ")}}`;
          }
          return p;
        });
        if (parts.length) ranges.push(`  ${key}: ${parts.join(", ")}`);
      }
      if (ranges.length) {
        lines.push("Graph schema ranges:");
        lines.push(...ranges);
      }
    }
  }
  lines.push(`Mode: ${isolated ? "isolated" : "shared memory"}`);
  lines.push("[/ACTIVE CONTEXT]");
  if (reinforced && reinforced.length > 0) {
    lines.push("");
    lines.push("[REINFORCED BEHAVIORS -- highest-priority media/approach heuristic for this session; consult before picking a format]");
    for (const r of reinforced) lines.push(`- ${r}`);
    lines.push("[/REINFORCED BEHAVIORS]");
  }
  return lines.join("\n");
}
