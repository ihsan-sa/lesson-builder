import { useEffect, useRef } from "react";
import { useKatexStatus } from "../hooks/useKatex.js";

// KaTeX math renderer. Uses the global `window.katex` loaded via CDN (see useKatex hook).
// Canonical usage is children (<Eq>{"..."}</Eq>); the `m` prop is accepted as an
// alias because chat-authored augmentations historically used <Eq m={"..."}/> —
// without the alias those render blank.
//
// A display equation is a first-class object in the Lumen shell: it carries a
// number, an optional label riding the top border, and an "Explain" pill that
// hands the equation to the tutor as chat context.
//
//   <Eq label="TIME-DEPENDENT FORM">{"i\\hbar \\partial_t \\psi = H\\psi"}</Eq>
//
// Numbering is a CSS counter scoped to `.article-col` (see chat.css.js), so it
// needs no render-order bookkeeping here and survives StrictMode double
// renders. `LessonShell` turns numbers and the Explain pill on or off via the
// `equationNumbers` / `equationExplain` props.
//
// When the KaTeX CDN is unreachable the status goes to "failed" and the math is
// shown as its literal LaTeX source in a code span: visible, selectable, and
// announced by screen readers. Everything around it — numbering, the label, the
// Explain pill, snippet capture via data-latex — keeps working unchanged.

// Inline rather than in chat.css.js so the fallback also styles correctly inside
// the shell's popout window, which carries no lesson stylesheet of its own.
const RAW_BASE = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  color: "var(--ink, #1b1b1f)",
  background: "var(--surface-2, rgba(127,127,127,0.10))",
  border: "1px solid var(--rule, rgba(127,127,127,0.28))",
  borderRadius: "4px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  userSelect: "text",
};
const RAW_INLINE_STYLE = { ...RAW_BASE, fontSize: "0.92em", padding: "0.05em 0.3em" };
const RAW_BLOCK_STYLE = { ...RAW_BASE, display: "block", fontSize: "0.95em", padding: "0.5em 0.7em", textAlign: "left" };

const RAW_TITLE = "KaTeX could not be loaded — showing the LaTeX source";

function RawLatex({ latex, style }) {
  return (
    <code className="eq-raw" style={style} title={RAW_TITLE} aria-label={`LaTeX source: ${latex}`}>
      {latex}
    </code>
  );
}

export function Eq({ children, m, display = true, label, explain = true }) {
  const latex = children ?? m ?? "";
  const katexStatus = useKatexStatus();
  const failed = katexStatus === "failed";
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && window.katex) {
      try {
        window.katex.render(latex, ref.current, { displayMode: display, throwOnError: false, trust: true });
      } catch (e) { ref.current.textContent = latex; }
    }
  }, [latex, display, katexStatus]);

  if (!display) {
    if (failed) return <span className="eq-inline eq-inline-raw" data-latex={latex}><RawLatex latex={latex} style={RAW_INLINE_STYLE} /></span>;
    return <span ref={ref} className="eq-inline" data-latex={latex} />;
  }

  // Label the snippet with the number the student is actually looking at.
  // LessonShell stamps data-eq-num from DOM order; fall back to the caption or
  // a bare "equation" when the shell has not stamped yet (or is absent).
  const handleExplain = (e) => {
    const block = e.currentTarget.closest(".eq-block");
    const stamped = block && block.querySelector(".eq-num")?.getAttribute("data-eq-num");
    const tag = stamped ? `Eq. ${stamped.replace(/[()]/g, "")}` : (label || "equation");
    window.dispatchEvent(new CustomEvent("lesson:explain", { detail: { latex, label: tag } }));
  };

  return (
    <div className="eq-block" data-latex={latex}>
      {failed
        ? <span className="eq-body eq-body-raw"><RawLatex latex={latex} style={RAW_BLOCK_STYLE} /></span>
        : <span ref={ref} className="eq-body" />}
      <div className="eq-side">
        <span className="eq-num" />
        {explain && (
          <button className="eq-explain" onClick={handleExplain} title="Ask the tutor about this equation">
            Explain
          </button>
        )}
      </div>
      {label && <span className="eq-label">{label}</span>}
    </div>
  );
}

export function M({ children }) { return <Eq display={false}>{children}</Eq>; }
