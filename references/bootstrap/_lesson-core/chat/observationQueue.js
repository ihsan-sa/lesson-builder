/**
 * Per-session observation queue + stuck detector.
 * Observations are prepended to the next user message as
 * [OBSERVATION]...[/OBSERVATION] blocks. The client should slice
 * off this prefix before rendering the student bubble.
 */

const _state = new Map(); // sessionId -> { preambles: string[], attempts: Map<target, {count, lastError}> }

function _ensure(sessionId) {
  if (!_state.has(sessionId)) {
    _state.set(sessionId, { preambles: [], attempts: new Map() });
  }
  return _state.get(sessionId);
}

/**
 * Queue an observation block for the next turn.
 * @param {string} sessionId
 * @param {string} type - 'edit-rejection' | 'demo-lint' | 'suggest-missing' | 'visual-verify' | 'stuck' | ...
 * @param {object|string} details - gets formatted into the preamble body.
 */
export function enqueue(sessionId, type, details) {
  if (!sessionId) return;
  const s = _ensure(sessionId);
  const body = _formatBody(type, details);
  s.preambles.push(`[OBSERVATION - ${type}]\n${body}\n[/OBSERVATION]`);
}

/** Return concatenated preambles and clear them. Includes trailing \n\n separator. */
export function drain(sessionId) {
  if (!sessionId) return "";
  const s = _state.get(sessionId);
  if (!s || s.preambles.length === 0) return "";
  const out = s.preambles.join("\n\n") + "\n\n";
  s.preambles = [];
  return out;
}

/**
 * Feed the stuck detector. target identifies the thing being worked on
 * (e.g. 'graph:infiniteWellWavefunctions.nMax').
 * outcome: 'success' | 'failure'. Success clears the counter.
 */
export function noteAttempt(sessionId, target, outcome) {
  if (!sessionId || !target) return;
  const s = _ensure(sessionId);
  if (outcome === "success") {
    s.attempts.delete(target);
    return;
  }
  const cur = s.attempts.get(target) || { count: 0, lastError: null };
  cur.count += 1;
  s.attempts.set(target, cur);
}

/**
 * Check if a target has crossed the stuck threshold. Returns a stuck message
 * if stuck, null otherwise. Soft heuristic: 5 attempts.
 */
export function checkStuck(sessionId, target) {
  if (!sessionId || !target) return null;
  const s = _state.get(sessionId);
  if (!s) return null;
  const cur = s.attempts.get(target);
  if (!cur || cur.count < 5) return null;
  return `You've attempted '${target}' ${cur.count} times without landing it. Step back: ask the student what they're actually looking for, or try a fundamentally different approach.`;
}

/** Reset attempt counters (on new tab, new topic, or course-correction). */
export function resetAttempts(sessionId, _reason) {
  if (!sessionId) return;
  const s = _state.get(sessionId);
  if (!s) return;
  s.attempts.clear();
}

/** Clean up a session entirely (on session close/delete). */
export function cleanup(sessionId) {
  _state.delete(sessionId);
}

function _formatBody(type, details) {
  if (typeof details === "string") return details;
  if (!details) return "";
  if (type === 'visual') {
    const { graphKey, renderId, viteUrl, tabId } = details || {};
    const lines = ['The graph was updated. To verify the result:'];
    lines.push(`1. Call mcp__playwright__browser_navigate with url: ${viteUrl || 'http://localhost:5173'}/?tab=${tabId || ''}`);
    lines.push(`2. Call mcp__playwright__browser_take_screenshot targeting the element with selector [data-graph-key="${graphKey}"][data-graph-render-id="${renderId}"]`);
    lines.push('3. Spawn visual-qa-agent and scientific-accuracy-agent in parallel on the screenshot to review the edited graph.');
    lines.push('4. Synthesize the reviewer reports and tell the student if the result matches intent. If it does not, emit a corrective EDIT_GRAPH.');
    return lines.join('\n');
  }
  if (type === "edit-rejection" && details.errors) {
    const lines = ["Your EDIT_GRAPH was processed:"];
    if (details.applied && Object.keys(details.applied).length > 0) {
      lines.push("Applied:");
      for (const [k, v] of Object.entries(details.applied)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    } else {
      lines.push("Applied: (none)");
    }
    lines.push("Rejected:");
    for (const err of details.errors) {
      const where = err.graphKey ? (err.param ? `${err.graphKey}.${err.param}` : err.graphKey) : "(payload)";
      lines.push(`  ${where}: ${err.reason}`);
    }
    lines.push("Correct and re-emit EDIT_GRAPH if needed.");
    return lines.join("\n");
  }
  try { return JSON.stringify(details, null, 2); } catch { return String(details); }
}
