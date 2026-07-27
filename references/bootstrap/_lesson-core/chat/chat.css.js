// All CSS for lessons: Lumen design tokens, shell layout (top bar, contents
// rail, article), content blocks, tutor panel + docking, bubbles, threads,
// context menu, collapsible blocks. Injected via <style>{STYLES}</style> from
// the lesson file (both during KaTeX loading and in the main tree).
//
// Palette and metrics come from the Claude Design "Lumen" handoff. The design
// specifies a single light palette; there is no dark variant. Legacy variable
// names (--bg-main, --text-dim, ...) are kept as aliases onto the Lumen tokens
// so older rules and any lesson-local styles keep resolving.
export const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

:root, .theme-light {
  /* ── Lumen tokens ── */
  --canvas: #FAF9F6;
  --surface: #F4F1EB;
  --surface-2: #EDE8DF;
  --ink: #1F1E1B;
  --ink-2: #3A3833;
  --ink-3: #6B6862;
  --ink-4: #9C988F;
  --border: #E8E4DC;
  --accent: #C96442;
  --accent-hover: #B8553A;
  --accent-soft: #F5E6DF;
  --accent-ink: #5C2A1B;
  --danger: #B14B3F;

  /* Semantic hues the shell needs but Lumen does not name: the formula-sheet
     and course-summary callouts. Tuned to sit on paper without shouting. */
  --sage: #4F7A52;
  --sage-soft: rgba(79, 122, 82, 0.07);
  --sage-border: rgba(79, 122, 82, 0.30);
  --rose: #9C5A78;
  --rose-soft: rgba(156, 90, 120, 0.07);
  --rose-border: rgba(156, 90, 120, 0.30);

  --font-display: 'Source Serif 4', Georgia, 'Times New Roman', serif;
  --font-ui: 'Inter Tight', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace;

  --ease: cubic-bezier(0.2, 0, 0, 1);
  --t-micro: 150ms;
  --t-surface: 220ms;

  --shadow-window: 0 20px 48px -16px rgba(31, 30, 27, 0.28);

  /* ── Legacy aliases (do not remove; older rules resolve through these) ── */
  --bg-main: var(--canvas);
  --bg-panel: var(--surface);
  --bg-card: var(--surface);
  --bg-eq: var(--surface);
  --text-primary: var(--ink);
  --text-secondary: var(--ink-2);
  --text-dim: var(--ink-3);
  --text-muted: var(--ink-3);
  --chat-user-bg: var(--surface-2);
  --chat-user-text: var(--ink);
  --chat-input-text: var(--ink);
  --chat-placeholder: var(--ink-4);
  --chat-chip-bg: var(--accent-soft);
  --chat-chip-border: var(--border);
  --chat-katex: var(--ink);
  --chat-badge-text: var(--canvas);
  --chat-toggle-active-bg: var(--surface-2);
  --chat-sent-dim: var(--ink-3);
  --chat-sent-dim-bg: var(--surface-2);
  --chat-stop-contrast: var(--canvas);
  --chat-stop-color: var(--danger);
  --ctx-hover-outline: rgba(201, 100, 66, 0.42);
  --ctx-hover-bg: rgba(201, 100, 66, 0.05);
  --ctx-flash-bg: rgba(201, 100, 66, 0.14);
}

/* ───────────────────────────────────────────────────────────────
   Shell: fixed-height flex column filling the viewport
   ─────────────────────────────────────────────────────────────── */

.lesson-shell {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-ui);
}
.lesson-shell *, .lesson-shell *::before, .lesson-shell *::after { box-sizing: border-box; }

/* ── Top bar (66px) ── */
.topbar {
  height: 66px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
  background: var(--canvas);
}
.topbar-left { display: flex; align-items: center; gap: 13px; min-width: 0; }
.topbar-right { display: flex; align-items: center; gap: 10px; flex: none; }

.rail-toggle {
  width: 30px; height: 30px; flex: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--canvas);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  transition: background var(--t-micro) var(--ease);
}
.rail-toggle:hover { background: var(--surface); }

.topbar-monogram {
  width: 30px; height: 30px; flex: none;
  border-radius: 8px;
  background: var(--ink);
  color: var(--canvas);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  user-select: none;
}
.topbar-titles { min-width: 0; }
.topbar-course {
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.topbar-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Position indicator — where you are in the lesson, not a completion score. */
.topbar-position {
  display: flex; align-items: center; gap: 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 12px;
  flex: none;
}
.topbar-position-track {
  width: 72px; height: 4px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
}
.topbar-position-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width var(--t-surface) var(--ease);
}
.topbar-position-label { font-size: 12px; color: var(--ink-3); white-space: nowrap; }

.tutor-btn {
  padding: 8px 15px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--ink-2);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--t-micro) var(--ease), color var(--t-micro) var(--ease), border-color var(--t-micro) var(--ease);
}
.tutor-btn:hover { background: var(--surface); }
.tutor-btn-on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--canvas);
}
.tutor-btn-on:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.topbar-popout {
  width: 36px; height: 34px; flex: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--canvas);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  transition: background var(--t-micro) var(--ease);
}
.topbar-popout:hover { background: var(--surface); }

/* ── Body row: rail | (article + docked tutor) ── */
.shell-body { flex: 1; min-height: 0; display: flex; }

/* ── Contents rail ── */
.rail {
  width: 262px;
  flex: none;
  padding: 20px 12px 0;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--canvas);
  transition: width var(--t-surface) var(--ease);
}
.rail-collapsed {
  width: 48px;
  padding: 20px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.rail-label {
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-4);
  padding: 0 10px 10px;
}
.rail-topic {
  display: flex; align-items: baseline; gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background var(--t-micro) var(--ease);
}
.rail-topic:hover { background: var(--surface); }
.rail-topic-num {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
  flex: none;
}
.rail-topic-title {
  font-size: 14px;
  line-height: 1.35;
  letter-spacing: -0.005em;
  color: var(--ink-3);
  font-weight: 400;
}
.rail-topic-active { background: var(--surface); }
.rail-topic-active .rail-topic-num { color: var(--accent); }
.rail-topic-active .rail-topic-title { color: var(--ink); font-weight: 500; }

.rail-outline { padding: 2px 10px 8px 30px; }
.rail-outline-item {
  display: block;
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--ink-4);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: color var(--t-micro) var(--ease), border-color var(--t-micro) var(--ease);
}
.rail-outline-item:hover { color: var(--ink-3); }
.rail-outline-current { border-left-color: var(--accent); color: var(--ink); }

.rail-refs {
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.rail-ref {
  display: block;
  padding: 5px 10px;
  font-size: 13px;
  color: var(--ink-3);
  text-decoration: none;
  border-radius: 6px;
}
.rail-ref:hover { color: var(--ink); background: var(--surface); }

.rail-num-only {
  width: 30px;
  padding: 6px 0;
  border: 0;
  background: transparent;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
  cursor: pointer;
  text-align: center;
}
.rail-num-only:hover { background: var(--surface); }
.rail-num-active { color: var(--accent); }

/* ── Main column: article stacked over an optional bottom-docked tutor ── */
.shell-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

.article {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 34px 52px 130px;
  scroll-behavior: smooth;
}
.article-col { max-width: 680px; }

.article-kicker {
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 10px;
}
.article-title {
  font-family: var(--font-display);
  font-size: 38px; font-weight: 500;
  line-height: 1.15; letter-spacing: -0.02em;
  color: var(--ink);
  margin: 0 0 12px;
}
.article-blurb {
  font-size: 17px; line-height: 1.55;
  color: var(--ink-2);
  max-width: 600px;
}
.article-rule { height: 1px; background: var(--border); margin: 26px 0 30px; }

/* ───────────────────────────────────────────────────────────────
   Content blocks (the contract between the generator and the shell)
   ─────────────────────────────────────────────────────────────── */

.section { margin: 0 0 8px; }
.section-title {
  font-family: var(--font-display);
  font-size: 24px; font-weight: 500;
  line-height: 1.3;
  color: var(--ink);
  margin: 38px 0 14px;
  scroll-margin-top: 18px;
}
.section .section .section-title { font-size: 19px; margin: 26px 0 10px; }

.para {
  font-size: 16px; line-height: 1.68;
  color: var(--ink-2);
  margin: 0 0 16px;
  text-wrap: pretty;
}
.para b, .para strong { color: var(--ink); font-weight: 600; }
.para i, .para em { color: var(--ink-3); }

/* Equation block. LessonShell stamps data-eq-num on each .eq-num span from
   DOM order; graph wrappers use .eq-block too but carry no data-latex, so they
   are skipped and never take a number. */
.eq-block {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin: 10px 0 24px;
  padding: 24px;
  min-height: 82px;
  /* Must stay visible: the optional label is positioned at top:-8px and rides
     the top border. Any overflow value but visible clips it. Long math scrolls
     inside .eq-body instead. */
  overflow: visible;
}
.eq-block[data-latex] { padding-right: 92px; }
.eq-block .eq-body { flex: 1; text-align: center; font-size: 18px; min-width: 0; overflow-x: auto; }
.eq-block .katex { font-size: 1.0em; }
.eq-block .katex-html { color: var(--ink); }
.katex-mathml { position: absolute !important; clip: rect(1px,1px,1px,1px) !important; clip-path: inset(50%) !important; height: 1px !important; width: 1px !important; overflow: hidden !important; white-space: nowrap !important; }
.eq-inline .katex { font-size: 1.0em; }
.eq-inline .katex-html { color: var(--ink); }

.eq-side {
  position: absolute;
  right: 16px; top: 50%;
  transform: translateY(-50%);
  display: flex; flex-direction: column; align-items: flex-end; gap: 7px;
}
.eq-num {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink-4);
  white-space: nowrap;
}
.eq-num::before { content: attr(data-eq-num); }
.article[data-eq-nums="off"] .eq-num { display: none; }
.eq-explain {
  border: 1px solid var(--border);
  background: var(--canvas);
  color: var(--accent);
  font-family: inherit;
  font-size: 12px; font-weight: 500;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--t-micro) var(--ease), color var(--t-micro) var(--ease);
}
.eq-explain:hover { background: var(--accent); color: var(--canvas); border-color: var(--accent); }
.article[data-eq-explain="off"] .eq-explain { display: none; }

/* Optional label riding the top border. The background knocks the border out,
   so it must match whatever surface the block sits on. */
.eq-label {
  position: absolute;
  left: 24px; top: -8px;
  background: var(--canvas);
  padding: 0 7px;
  font-size: 11px; font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--ink-4);
}

/* Callout — Lumen "note" */
.key-concept {
  background: var(--accent-soft);
  border-radius: 10px;
  padding: 18px 20px;
  margin: 10px 0 24px;
}
.kc-label {
  display: block;
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--accent-ink);
  margin-bottom: 6px;
}
.kc-body { font-size: 15.5px; line-height: 1.62; color: var(--accent-ink); }
.kc-body .para { color: var(--accent-ink); }
.hw-tested { box-shadow: inset 3px 0 0 var(--sage); }
.hw-tested .kc-label::after { content: " [TESTED]"; color: var(--sage); font-size: 10px; font-weight: 500; }

.formula-sheet-box {
  background: var(--sage-soft);
  border: 1px solid var(--sage-border);
  border-radius: 10px;
  padding: 18px 20px;
  margin: 10px 0 24px;
}
.fsb-label {
  display: block;
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--sage);
  margin-bottom: 6px;
}
.fsb-body { font-size: 15.5px; line-height: 1.62; color: var(--ink-2); }
.fsb-body .para, .fsb-body p { color: var(--ink-2); margin: 6px 0; }
.fsb-body .eq-block { margin: 8px 0; background: var(--canvas); }
.fsb-body .eq-label { background: var(--canvas); }

.summary-box {
  background: var(--rose-soft);
  border: 1px solid var(--rose-border);
  border-radius: 10px;
  padding: 18px 20px;
  margin: 10px 0 24px;
}
.sb-label {
  display: block;
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--rose);
  margin-bottom: 6px;
}
.sb-body { font-size: 15.5px; line-height: 1.62; color: var(--ink-2); }
.sb-body .para, .sb-body p { color: var(--ink-2); margin: 6px 0; }
.sb-body .eq-block { margin: 8px 0; background: var(--canvas); }
.sb-body .eq-label { background: var(--canvas); }

.info-list { margin: 8px 0 20px; padding-left: 18px; list-style: none; }
.info-list li {
  position: relative;
  font-size: 16px; line-height: 1.68;
  color: var(--ink-2);
  padding: 3px 0 3px 4px;
}
.info-list li::before {
  content: "";
  position: absolute; left: -14px; top: 0.72em;
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--accent);
}

.compare-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 12px 0 24px; }
.compare-card {
  padding: 18px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.compare-card h4 {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 16px; font-weight: 600;
  color: var(--ink);
}

/* Terms table — Lumen "terms" block */
.data-table { margin: 8px 0 28px; overflow-x: auto; }
.data-table table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.data-table th {
  text-align: left;
  padding: 14px 0;
  font-family: var(--font-display);
  font-size: 16px; font-weight: 600;
  color: var(--ink);
  border-bottom: 1px solid var(--border);
}
.data-table td {
  padding: 14px 0;
  color: var(--ink-3);
  line-height: 1.6;
  border-bottom: 1px solid var(--border);
}
.data-table td + td, .data-table th + th { padding-left: 20px; }

/* Figure container — graphs and images */
.figure-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px 18px;
  margin: 12px 0 10px;
}
.figure-caption { font-size: 13px; line-height: 1.5; color: var(--ink-3); margin: 10px 0 28px; }
.figure-num { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-4); }

.graph-controls {
  display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
  margin-bottom: 10px; padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.graph-controls label { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 180px; }
.graph-ctrl-label { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); font-weight: 500; white-space: nowrap; min-width: 120px; }
.graph-slider { flex: 1; min-width: 100px; height: 4px; accent-color: var(--accent); cursor: pointer; }
.graph-select {
  background: var(--canvas); border: 1px solid var(--border); border-radius: 6px;
  color: var(--ink-2); font-size: 12px; font-family: var(--font-ui); padding: 5px 8px; cursor: pointer;
}
.graph-select:focus { border-color: var(--accent); outline: none; }

.ctrl-btn {
  padding: 6px 14px; border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--canvas);
  color: var(--ink-2);
  font-family: var(--font-ui); font-size: 12.5px; font-weight: 500;
  cursor: pointer;
  transition: background var(--t-micro) var(--ease);
}
.ctrl-btn:hover { background: var(--surface); }

/* Collapsible */
.collapsible-block {
  margin: 10px 0 24px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--canvas);
}
.collapsible-toggle {
  width: 100%; text-align: left;
  padding: 12px 16px;
  background: var(--surface);
  border: none;
  color: var(--ink-2);
  font-family: var(--font-ui); font-size: 13.5px; font-weight: 500;
  cursor: pointer;
  transition: color var(--t-micro) var(--ease);
}
.collapsible-toggle:hover { color: var(--accent); }
.collapsible-content { padding: 16px 18px; background: var(--canvas); }

/* PracticeProblem */
.practice-problem {
  margin: 16px 0 24px;
  padding: 18px 20px;
  background: var(--canvas);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.practice-problem.pp-has-official { border-left: 3px solid var(--accent); }
.pp-header {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 12px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.pp-badge {
  font-size: 10px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 999px;
}
.pp-badge-official { background: var(--accent); color: var(--canvas); }
.pp-badge-ai { background: var(--surface-2); color: var(--ink-3); }
.pp-source { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-4); }
.pp-difficulty {
  font-family: var(--font-mono); font-size: 10px;
  color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em;
  padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px;
  margin-left: auto;
}
.pp-diff-intro { color: var(--sage); border-color: var(--sage-border); }
.pp-diff-core { color: var(--ink-3); }
.pp-diff-stretch { color: var(--accent); border-color: var(--accent); }
.pp-statement { font-size: 15.5px; line-height: 1.62; color: var(--ink-2); }
.pp-statement .para { margin-bottom: 8px; }
.pp-solution-wrap { border-top: 1px solid var(--border); margin-top: 12px; padding-top: 10px; }
.pp-solution-toggle {
  background: none; border: none; padding: 4px 0;
  color: var(--accent); font-family: var(--font-ui);
  font-size: 13px; font-weight: 500; cursor: pointer;
}
.pp-solution-toggle:hover { color: var(--accent-hover); }
.pp-solution-body { padding: 10px 0 2px; font-size: 15.5px; line-height: 1.62; color: var(--ink-2); }
.pp-solution-body .para { margin-bottom: 8px; }
.pp-ai-sources { margin-top: 14px; padding: 12px 14px; background: var(--surface); border-radius: 8px; }
.pp-ai-sources-label {
  font-size: 10.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-4); margin-bottom: 6px;
}
.pp-ai-sources-list { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--ink-3); }
.pp-ai-sources-list li { margin-bottom: 3px; line-height: 1.5; }
.pp-ai-sources-list a { color: var(--ink-3); text-decoration: underline; text-decoration-color: var(--border); }
.pp-ai-sources-list a:hover { color: var(--accent); text-decoration-color: var(--accent); }

/* ───────────────────────────────────────────────────────────────
   Tutor panel
   ─────────────────────────────────────────────────────────────── */

/* Resize strips: 9px hit area with a hairline centered in it. */
.tutor-resize-x {
  width: 9px; flex: none;
  cursor: col-resize;
  background: var(--canvas);
  display: flex; align-items: center; justify-content: center;
  touch-action: none;
}
.tutor-resize-y {
  height: 9px; flex: none;
  cursor: row-resize;
  background: var(--canvas);
  display: flex; align-items: center; justify-content: center;
  touch-action: none;
}
.tutor-resize-x::before { content: ""; width: 1px; height: 100%; background: var(--border); }
.tutor-resize-y::before { content: ""; height: 1px; width: 100%; background: var(--border); }

.chat-panel {
  background: var(--surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
}
/* Docked slots. The panel fills its slot; the slot owns the dimension the
   resize handles drive, so the panel itself never changes tree position. */
.tutor-host { display: contents; }
.tutor-slot { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.tutor-slot-side { flex: none; height: 100%; }
.tutor-slot-bottom { flex: none; width: 100%; }
.chat-panel-side, .chat-panel-bottom { width: 100%; height: 100%; flex: 1; }

/* In-app floating window: the fallback when the browser blocks pop-ups. */
.chat-panel-window {
  position: fixed;
  z-index: 999;
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-window);
}
.chat-window-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  flex: none;
  user-select: none;
}
.chat-window-bar:active { cursor: grabbing; }
.chat-window-title { font-size: 12px; font-weight: 500; color: var(--ink-2); flex: 1; min-width: 0; }
.chat-window-grip {
  position: absolute; right: 0; bottom: 0;
  width: 16px; height: 16px;
  cursor: nwse-resize;
  touch-action: none;
}
.chat-window-grip::after {
  content: ""; position: absolute; right: 3px; bottom: 3px;
  width: 7px; height: 7px;
  border-right: 1.5px solid var(--ink-4);
  border-bottom: 1.5px solid var(--ink-4);
}
.chat-blocked-note { font-size: 11px; color: var(--danger); padding: 0 12px 6px; }

/* Panel is the whole document when portaled into a real browser window. */
.chat-panel-popup { height: 100dvh; width: 100%; }

/* Standalone fallback: no LessonShell around the Chatbot (the Lumen embed
   shape, any bare mount). Floats bottom-right with its own resize handles. */
.chat-panel-float {
  position: fixed; bottom: 12px; right: 12px;
  width: min(42vw, 720px);
  height: 85vh;
  max-height: calc(100vh - 80px);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-window);
  z-index: 999;
  transition: width var(--t-surface) var(--ease), height var(--t-surface) var(--ease);
}
.chat-panel-float.chat-panel-expanded {
  --chat-content-w: 768px;
  top: 12px; height: auto;
  width: calc(100vw - var(--chat-content-w) - 24px);
  min-width: 380px;
  max-width: calc(100vw - 24px);
}
@media (max-width: 1100px) { .chat-panel-float.chat-panel-expanded { width: min(600px, calc(100vw - 40px)); top: auto; height: min(80vh, 700px); } }
@media (max-width: 480px) {
  .chat-panel-float { width: calc(100vw - 32px); right: 16px; bottom: 12px; height: 60vh; }
  .chat-panel-float.chat-panel-expanded { width: calc(100vw - 16px); right: 8px; bottom: 8px; top: 8px; height: auto; }
}
.chat-resize-l { position: absolute; left: -3px; top: 12px; bottom: 12px; width: 6px; cursor: ew-resize; z-index: 10; }
.chat-resize-t { position: absolute; top: -3px; left: 12px; right: 12px; height: 6px; cursor: ns-resize; z-index: 10; }
.chat-resize-tl { position: absolute; top: -4px; left: -4px; width: 12px; height: 12px; cursor: nwse-resize; z-index: 11; }

/* ── Tab strip (Chrome-style) ── */
.chat-tabs {
  display: flex; align-items: flex-end; gap: 2px;
  padding: 8px 8px 0;
  background: var(--surface-2);
  overflow-x: auto;
  flex: none;
  scrollbar-width: none;
}
.chat-tabs::-webkit-scrollbar { display: none; }
.chat-tab {
  display: flex; align-items: center; gap: 6px;
  flex: none;
  max-width: 180px;
  padding: 7px 7px 7px 12px;
  border: 0;
  border-radius: 9px 9px 0 0;
  background: transparent;
  color: var(--ink-3);
  font-family: inherit;
  font-size: 12.5px; font-weight: 400;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--t-micro) var(--ease);
}
.chat-tab:hover { background: rgba(250, 249, 246, 0.5); }
.chat-tab.active { background: var(--surface); color: var(--ink); font-weight: 500; }
.chat-tab-label { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.chat-tab-x {
  flex: none;
  font-size: 15px; line-height: 1;
  color: var(--ink-4);
  cursor: pointer;
  padding: 0 2px;
}
.chat-tab-x:hover { color: var(--ink); }
.chat-tab-add {
  width: 26px; height: 26px; flex: none;
  margin: 0 0 4px 4px;
  border: 0; border-radius: 7px;
  background: transparent;
  color: var(--ink-3);
  font-size: 17px; line-height: 1;
  cursor: pointer;
  padding: 0;
}
.chat-tab-add:hover { background: rgba(250, 249, 246, 0.6); }

/* ── Panel header ── */
.chat-header {
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: flex-start; gap: 10px;
  flex: none;
}
.chat-header-titles { flex: 1; min-width: 0; }
.chat-header-title {
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-4);
  margin-bottom: 5px;
}
.chat-header-topic {
  display: flex; align-items: center; gap: 7px;
  font-size: 14px; font-weight: 500;
  color: var(--ink);
  min-width: 0;
}
.chat-header-topic > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-header-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex: none; }
.chat-header-actions { display: flex; align-items: center; gap: 8px; flex: none; }

.chat-dock-switch {
  display: flex; gap: 2px;
  padding: 2px;
  background: var(--surface-2);
  border-radius: 8px;
}
.chat-dock-btn {
  width: 28px; height: 24px;
  border: 0; border-radius: 6px;
  background: transparent;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  color: var(--ink-4);
}
.chat-dock-btn:hover { color: var(--ink-3); }
.chat-dock-btn.active { background: var(--canvas); color: var(--accent); }

.chat-icon-btn {
  width: 30px; height: 30px; flex: none;
  border: 0; border-radius: 8px;
  background: transparent;
  color: var(--ink-4);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  transition: background var(--t-micro) var(--ease), color var(--t-micro) var(--ease);
}
.chat-icon-btn:hover { background: var(--surface-2); color: var(--ink-2); }
.chat-icon-btn.active { background: var(--surface-2); color: var(--accent); }

/* ── Settings popover ── */
.chat-settings {
  padding: 16px 18px;
  background: var(--canvas);
  border-bottom: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 14px;
  flex: none;
}
.chat-setting-label {
  font-size: 11.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-4);
  margin-bottom: 6px;
}
/* Wraps rather than scrolls: the model list is 7 long, and a horizontally
   scrolling track with no visible scrollbar hides options entirely. */
.chat-segmented {
  display: flex; flex-wrap: wrap; gap: 2px;
  padding: 3px;
  background: var(--surface-2);
  border-radius: 8px;
}
.chat-segment {
  flex: 1;
  min-width: max-content;
  padding: 5px 10px;
  border: 0; border-radius: 6px;
  background: transparent;
  color: var(--ink-3);
  font-family: inherit;
  font-size: 12.5px; font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--t-micro) var(--ease), color var(--t-micro) var(--ease);
}
.chat-segment:hover { color: var(--ink); }
.chat-segment.active { background: var(--accent); color: var(--canvas); }
.chat-segment.active:hover { color: var(--canvas); }
.chat-setting-help { font-size: 12px; color: var(--ink-4); margin-top: 6px; line-height: 1.5; }

/* ── Transcript ── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 18px;
  display: flex; flex-direction: column; gap: 22px;
  min-height: 0;
}
.chat-empty { font-size: 14px; color: var(--ink-4); line-height: 1.6; padding: 24px 4px; }
.chat-msg { display: flex; flex-direction: column; gap: 6px; }
.chat-msg::before {
  font-size: 11px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
}
.chat-msg-user::before { content: "You"; color: var(--ink-4); }
.chat-msg-assistant::before { content: "Tutor"; color: var(--accent); }
.chat-msg-anchor::before { content: none; }
.chat-msg-bubble {
  max-width: 100%;
  font-size: 15px; line-height: 1.65;
  color: var(--ink-2);
  word-wrap: break-word; overflow-wrap: break-word;
}
.chat-msg-user .chat-msg-bubble { white-space: pre-wrap; }
.chat-msg-rendered { background: transparent; color: var(--ink-2); border: none; max-width: 100%; }
.chat-msg-rendered strong { color: var(--ink); font-weight: 600; }
.chat-msg-rendered .chat-code {
  background: var(--surface-2); color: var(--ink);
  padding: 1px 5px; border-radius: 4px;
  font-family: var(--font-mono); font-size: 0.88em;
}
.chat-msg-rendered .chat-pre {
  background: var(--canvas); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 14px; margin: 8px 0; overflow-x: auto;
}
.chat-msg-rendered .chat-code-block { font-family: var(--font-mono); font-size: 0.85em; color: var(--ink-2); white-space: pre; display: block; }
.chat-msg-rendered .chat-eq-block {
  margin: 10px 0;
  padding: 14px 12px;
  background: var(--canvas);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-align: center;
  overflow-x: auto;
}
.chat-msg-rendered .chat-eq-block .katex { font-size: 1.05em; }
.chat-msg-rendered .katex { font-size: 1.0em; }
.chat-msg-rendered .katex-html { color: var(--ink); }
.chat-msg-rendered em { color: var(--ink-3); font-style: italic; }
.chat-msg-rendered .chat-h {
  font-family: var(--font-display);
  font-size: 16px; font-weight: 600;
  color: var(--ink); margin: 12px 0 5px;
}
.chat-msg-rendered .chat-ul { margin: 4px 0; padding-left: 18px; }
.chat-msg-rendered .chat-ol { margin: 4px 0; padding-left: 22px; }
.chat-msg-rendered .chat-li, .chat-msg-rendered .chat-oli { font-size: 15px; line-height: 1.65; color: var(--ink-2); }
.chat-msg-rendered .chat-table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13.5px; }
.chat-msg-rendered .chat-table th {
  color: var(--ink); font-weight: 600;
  padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left;
}
.chat-msg-rendered .chat-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--ink-2); }
.chat-msg-rendered .chat-hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }

.chat-loading { display: flex !important; flex-direction: row !important; gap: 5px; padding: 4px 0 !important; }
.chat-loading span { width: 6px; height: 6px; background: var(--ink-4); border-radius: 50%; animation: chatBounce 1.2s infinite; }
.chat-loading span:nth-child(2) { animation-delay: 0.15s; }
.chat-loading span:nth-child(3) { animation-delay: 0.3s; }
@keyframes chatBounce { 0%,80%,100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
.chat-status { font-size: 12.5px; color: var(--ink-4); font-style: italic; padding: 2px 0; }

/* ── Composer ── */
.chat-composer {
  border-top: 1px solid var(--border);
  padding: 12px 16px 14px;
  display: flex; flex-direction: column; gap: 10px;
  flex: none;
  background: var(--surface);
}
.chat-settings-chip { display: flex; align-items: center; gap: 8px; }
.chat-settings-chip-text {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-4);
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chat-settings-change {
  border: 0; background: none;
  color: var(--accent);
  font-family: inherit;
  font-size: 11.5px; font-weight: 500;
  cursor: pointer;
  padding: 0;
  flex: none;
}
.chat-settings-change:hover { color: var(--accent-hover); text-decoration: underline; }

.chat-input-row { display: flex; gap: 10px; align-items: flex-end; }
.chat-input {
  flex: 1;
  background: var(--canvas);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--ink);
  padding: 10px 13px;
  font-size: 14.5px;
  font-family: var(--font-ui);
  resize: none; outline: none;
  line-height: 1.45;
  min-width: 0;
}
.chat-input::placeholder { color: var(--ink-4); }
.chat-input:focus { border-color: var(--accent); }
.chat-send {
  width: 38px; height: 38px; flex: none;
  border-radius: 999px; border: 0;
  background: var(--accent);
  color: var(--canvas);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--t-micro) var(--ease);
}
.chat-send:hover:not(:disabled) { background: var(--accent-hover); }
.chat-send:disabled { opacity: 0.35; cursor: default; }
.chat-attach-btn {
  width: 38px; height: 38px; flex: none;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--canvas);
  color: var(--ink-3);
  font-size: 18px; line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--t-micro) var(--ease);
}
.chat-attach-btn:hover { background: var(--surface-2); }
.chat-stop {
  width: 38px; height: 38px; flex: none;
  border-radius: 999px;
  border: 1px solid var(--danger);
  background: transparent;
  color: var(--danger);
  font-size: 13px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--t-micro) var(--ease), color var(--t-micro) var(--ease);
}
.chat-stop:hover { background: var(--danger); color: var(--canvas); }

.chat-att-bar { display: flex; flex-wrap: wrap; gap: 6px; max-height: 90px; overflow-y: auto; }
.chat-att-preview {
  position: relative; display: inline-flex; align-items: center; gap: 4px;
  background: var(--canvas); border: 1px solid var(--border); border-radius: 8px; padding: 3px;
}
.chat-att-thumb { height: 48px; max-width: 80px; border-radius: 6px; object-fit: cover; display: block; }
.chat-att-fname { font-size: 10.5px; color: var(--ink-3); font-family: var(--font-mono); padding: 4px 6px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-att-rm {
  position: absolute; top: -5px; right: -5px;
  width: 16px; height: 16px; border-radius: 50%; border: none;
  background: var(--danger); color: var(--canvas);
  font-size: 9px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; line-height: 1;
}
.chat-msg-att-list { display: flex; flex-wrap: wrap; gap: 4px; }
.chat-att-thumb-sent { height: 56px; max-width: 100px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); }
.chat-att-file-sent { font-size: 10.5px; color: var(--ink-3); font-family: var(--font-mono); background: var(--surface-2); border-radius: 6px; padding: 4px 8px; }

/* ── Context chips ── */
.chat-ctx-bar { display: flex; flex-wrap: wrap; gap: 5px; max-height: 76px; overflow-y: auto; }
.chat-ctx-chip {
  display: flex; align-items: center; gap: 4px;
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 3px 6px 3px 11px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-ink);
  max-width: 100%;
  overflow: hidden;
}
.chat-ctx-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-ctx-chip-x {
  background: none; border: none;
  color: var(--accent-ink);
  font-size: 13px; line-height: 1;
  cursor: pointer; padding: 0 3px; flex: none;
}
.chat-ctx-chip-x:hover { color: var(--danger); }
.chat-msg-ctx-list { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.chat-msg-ctx-chip-sent {
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--accent-ink); background: var(--accent-soft);
  border-radius: 999px; padding: 2px 9px;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── Toggle (standalone Chatbot, i.e. no LessonShell around it) ── */
.chat-toggle {
  position: fixed; bottom: 20px; right: 20px;
  width: 48px; height: 48px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--accent);
  color: var(--canvas);
  font-size: 18px; font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-window);
  transition: background var(--t-micro) var(--ease);
  z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.chat-toggle:hover { background: var(--accent-hover); }
.chat-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 18px; height: 18px;
  background: var(--ink); color: var(--canvas);
  font-size: 10px; font-weight: 600;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  padding: 0 4px;
  font-family: var(--font-mono);
}

/* ───────────────────────────────────────────────────────────────
   Context capture (Ctrl-gated)
   ─────────────────────────────────────────────────────────────── */

.ctx-active .eq-block, .ctx-active .key-concept, .ctx-active .formula-sheet-box, .ctx-active .summary-box, .ctx-active .compare-card, .ctx-active .para, .ctx-active .info-list li, .ctx-active .section-title, .ctx-active .practice-problem { transition: outline var(--t-micro) var(--ease), background var(--t-micro) var(--ease); border-radius: 6px; }
body.ctx-ctrl-held .ctx-active .eq-block, body.ctx-ctrl-held .ctx-active .key-concept, body.ctx-ctrl-held .ctx-active .formula-sheet-box, body.ctx-ctrl-held .ctx-active .summary-box, body.ctx-ctrl-held .ctx-active .compare-card, body.ctx-ctrl-held .ctx-active .para, body.ctx-ctrl-held .ctx-active .info-list li, body.ctx-ctrl-held .ctx-active .section-title, body.ctx-ctrl-held .ctx-active .practice-problem { cursor: pointer; }
body.ctx-ctrl-held .ctx-active .eq-block:hover, body.ctx-ctrl-held .ctx-active .key-concept:hover, body.ctx-ctrl-held .ctx-active .formula-sheet-box:hover, body.ctx-ctrl-held .ctx-active .summary-box:hover, body.ctx-ctrl-held .ctx-active .compare-card:hover, body.ctx-ctrl-held .ctx-active .para:hover, body.ctx-ctrl-held .ctx-active .info-list li:hover, body.ctx-ctrl-held .ctx-active .practice-problem:hover { outline: 1px dashed var(--ctx-hover-outline); outline-offset: 2px; background: var(--ctx-hover-bg); }

@keyframes ctxFlash { 0% { background: var(--ctx-flash-bg); outline: 2px solid var(--accent); outline-offset: 2px; } 100% { background: transparent; outline: 2px solid transparent; outline-offset: 2px; } }
.ctx-flash { animation: ctxFlash 0.6s var(--ease) !important; }
.ctx-sel-flash {
  background: var(--accent); color: var(--canvas);
  font-size: 11px; font-weight: 600; font-family: var(--font-ui);
  padding: 2px 8px; border-radius: 999px;
  pointer-events: none; z-index: 9999;
  animation: ctxSelPop 0.8s var(--ease) forwards;
}
@keyframes ctxSelPop { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-10px); } }

.chat-msg-rendered [data-chat-block] { transition: outline var(--t-micro) var(--ease), background var(--t-micro) var(--ease); border-radius: 4px; }
body.ctx-ctrl-held .chat-msg-rendered [data-chat-block] { cursor: pointer; }
body.ctx-ctrl-held .chat-msg-rendered [data-chat-block]:hover { outline: 1px dashed var(--ctx-hover-outline); outline-offset: 2px; background: var(--ctx-hover-bg); }
.chat-reply-block { padding: 2px 0; }

/* ── Context menu ── */
.ctx-menu {
  position: fixed; z-index: 10000;
  background: var(--canvas);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  box-shadow: var(--shadow-window);
  font-family: var(--font-ui);
  min-width: 168px;
}
.ctx-menu-item {
  display: block; width: 100%;
  padding: 7px 12px;
  background: none; border: none; border-radius: 6px;
  color: var(--ink-2);
  font-family: inherit; font-size: 13px;
  cursor: pointer; text-align: left;
}
.ctx-menu-item:hover { background: var(--surface); color: var(--accent); }

/* ───────────────────────────────────────────────────────────────
   Chat-embedded media, sources, suggestions, commits
   ─────────────────────────────────────────────────────────────── */

.chat-demo-block { margin: 10px 0; padding: 12px; background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.chat-demo-title { font-size: 10.5px; font-family: var(--font-mono); color: var(--ink-4); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .08em; }
.chat-demo-block svg { display: block; margin: 0 auto; }

.chat-desmos-block { position: relative; margin: 10px 0; min-height: 520px; background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.chat-desmos-block:empty::before { content: 'Rendering graph...'; display: block; padding: 18px; text-align: center; font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); letter-spacing: .05em; text-transform: uppercase; }
.chat-desmos-host { width: 100%; height: 520px; }
.chat-desmos-error { padding: 14px; font-family: var(--font-mono); font-size: 12px; color: var(--danger); text-align: center; }

.chat-media-block { margin: 10px 0; padding: 12px; background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; text-align: center; }
.chat-media-block img, .chat-media-block video { max-width: 100%; border-radius: 8px; display: block; margin: 0 auto; }
.chat-media-block svg { display: block; margin: 0 auto; max-width: 100%; }

.chat-sources { margin: 10px 0 4px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; background: var(--canvas); }
.chat-sources summary { padding: 7px 11px; cursor: pointer; color: var(--ink-3); font-size: 11px; font-weight: 600; letter-spacing: .05em; }
.chat-sources summary:hover { color: var(--accent); }
.chat-sources ul { padding: 6px 10px 8px 24px; margin: 0; list-style: disc; }
.chat-sources li { color: var(--ink-3); margin: 2px 0; line-height: 1.5; }
.chat-sources a { color: var(--accent); text-decoration: none; }
.chat-sources a:hover { text-decoration: underline; }

.suggestion-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 11px; background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; flex-wrap: wrap; }
.suggestion-label { font-size: 12px; color: var(--ink-3); flex: 1; min-width: 120px; }
.suggestion-btn { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--border); font-size: 11.5px; font-family: inherit; font-weight: 500; cursor: pointer; transition: background var(--t-micro) var(--ease); }
.s-btn-lesson { background: var(--accent); color: var(--canvas); border-color: var(--accent); }
.s-btn-lesson:hover { background: var(--accent-hover); }
.s-btn-faq { background: var(--canvas); color: var(--accent); border-color: var(--accent); }
.s-btn-faq:hover { background: var(--accent-soft); }
.s-btn-no { background: none; color: var(--ink-3); }
.s-btn-no:hover { color: var(--danger); border-color: var(--danger); }

.commit-chip { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 11px; background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; flex-wrap: wrap; }
.commit-chip-ok { border-color: var(--accent); }
.commit-chip-err { border-color: var(--danger); }
.commit-chip-label { font-size: 12px; color: var(--ink-3); flex: none; }
.commit-chip-msg { font-size: 11px; font-family: var(--font-mono); color: var(--ink-2); background: var(--surface); padding: 3px 7px; border-radius: 6px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.commit-chip-btn { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--canvas); font-size: 11.5px; font-family: inherit; font-weight: 500; cursor: pointer; }
.commit-chip-btn:hover:not(:disabled) { background: var(--accent-hover); }
.commit-chip-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.commit-chip-btn-dismiss { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--border); background: none; color: var(--ink-3); font-size: 11.5px; font-family: inherit; cursor: pointer; }
.commit-chip-btn-dismiss:hover { color: var(--danger); border-color: var(--danger); }

/* ───────────────────────────────────────────────────────────────
   Thread panel
   ─────────────────────────────────────────────────────────────── */

.thread-panel { margin-top: 8px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--canvas); font-size: 14px; }
.thread-header { display: flex; align-items: center; gap: 8px; padding: 6px 11px; background: var(--surface); cursor: pointer; flex-wrap: wrap; min-height: 32px; }
.thread-collapse-btn { background: none; border: none; color: var(--ink-4); cursor: pointer; font-size: 10px; padding: 0 2px; flex: none; }
.thread-collapse-btn:hover { color: var(--accent); }
.thread-snippet { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); font-style: italic; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-count { font-size: 11px; color: var(--ink-4); font-family: var(--font-mono); flex: none; }
.thread-close-btn { background: none; border: none; color: var(--ink-4); cursor: pointer; font-size: 11px; padding: 0 2px; flex: none; margin-left: auto; }
.thread-close-btn:hover { color: var(--danger); }
.thread-portal-slot { margin: 4px 0; }
.thread-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.thread-msg { display: flex; flex-direction: column; gap: 4px; }
.thread-msg::before { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.thread-msg-user::before { content: "You"; color: var(--ink-4); }
.thread-msg-assistant::before { content: "Tutor"; color: var(--accent); }
.thread-msg .chat-msg-bubble { font-size: 14px; }
.thread-msg .chat-msg-rendered { font-size: 14px; }
.thread-loading { display: flex; gap: 4px; padding: 4px 0; }
.thread-loading span { width: 5px; height: 5px; background: var(--ink-4); border-radius: 50%; animation: chatBounce 1.2s infinite; }
.thread-loading span:nth-child(2) { animation-delay: 0.15s; }
.thread-loading span:nth-child(3) { animation-delay: 0.3s; }
.thread-input-row { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); margin-top: 4px; align-items: flex-end; }
.thread-input { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--ink); padding: 7px 11px; font-size: 14px; font-family: var(--font-ui); resize: none; outline: none; line-height: 1.45; min-width: 0; }
.thread-input:focus { border-color: var(--accent); }
.thread-send { width: 30px; height: 30px; border-radius: 999px; border: 0; background: var(--accent); color: var(--canvas); font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
.thread-send:hover { background: var(--accent-hover); }
.thread-ctx-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
.thread-att-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
.thread-loading-row { display: flex; align-items: center; gap: 8px; }
.thread-stop { width: 26px; height: 26px; border-radius: 999px; border: 1px solid var(--danger); background: transparent; color: var(--danger); font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
.thread-stop:hover { background: var(--danger); color: var(--canvas); }
.thread-attach { width: 30px; height: 30px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-3); font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; line-height: 1; }
.thread-attach:hover { background: var(--surface-2); }
/* A focused thread owns captured lesson context — make that visible, or the
   student cannot tell where their next Ctrl+Click is going to land. */
.thread-panel:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft); }

/* ── Lesson anchor (a thread opened on lesson content, not a chat reply) ── */
.chat-msg-anchor { align-items: stretch; }
.chat-anchor-card {
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 0 10px 10px 0;
  background: var(--canvas);
  padding: 10px 13px;
}
.chat-anchor-label {
  display: block;
  font-size: 10px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-4);
  margin-bottom: 4px;
}
.chat-anchor-body { padding: 0 !important; font-size: 14px; color: var(--ink-3); font-style: italic; max-height: 8.4em; overflow-y: auto; }

/* ── Dead-session recovery bar ── */
.chat-dead-session {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--danger);
  border-radius: 10px;
  background: var(--canvas);
  font-size: 12px;
  color: var(--ink-3);
}
.chat-dead-session button { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--canvas); font-size: 11.5px; font-family: inherit; font-weight: 500; cursor: pointer; }
.chat-dead-session button:hover { background: var(--accent-hover); }

/* ── Drag-and-drop attachment target ── */
.chat-panel-dragover { outline: 2px dashed var(--accent); outline-offset: -6px; }
.chat-panel-dragover::after {
  content: 'Drop image or PDF to attach';
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--ctx-hover-bg);
  color: var(--accent);
  font-size: 13px; letter-spacing: .05em;
  pointer-events: none; z-index: 20;
}

/* ── Shortcut overlay (Ctrl+Shift+/) ── */
.chat-help-overlay { position: absolute; inset: 0; z-index: 30; background: var(--canvas); display: flex; flex-direction: column; overflow-y: auto; padding: 16px 18px; }
.chat-help-overlay h4 { margin: 0 0 12px; font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); }
.chat-help-group { margin-bottom: 14px; }
.chat-help-group-title { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 5px; }
.chat-help-row { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; color: var(--ink-2); padding: 2px 0; }
.chat-help-key { flex: none; min-width: 132px; font-family: var(--font-mono); font-size: 11.5px; color: var(--accent); }
.chat-help-close { position: absolute; top: 12px; right: 14px; background: none; border: 1px solid var(--border); border-radius: 999px; color: var(--ink-3); font-family: inherit; font-size: 11.5px; cursor: pointer; padding: 3px 10px; }
.chat-help-close:hover { color: var(--accent); border-color: var(--accent); }

/* ── Production banner (chat is dev-only) ── */
.prod-banner {
  flex: none;
  background: var(--surface);
  color: var(--ink-3);
  text-align: center;
  padding: 7px 24px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
`;
