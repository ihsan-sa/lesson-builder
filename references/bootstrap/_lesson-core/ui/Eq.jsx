import { useEffect, useRef } from "react";

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
export function Eq({ children, m, display = true, label, explain = true }) {
  const latex = children ?? m ?? "";
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && window.katex) {
      try {
        window.katex.render(latex, ref.current, { displayMode: display, throwOnError: false, trust: true });
      } catch (e) { ref.current.textContent = latex; }
    }
  }, [latex, display]);

  if (!display) return <span ref={ref} className="eq-inline" data-latex={latex} />;

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
      <span ref={ref} className="eq-body" />
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
