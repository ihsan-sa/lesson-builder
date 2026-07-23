import { useEffect, useRef } from "react";

// KaTeX math renderer. Uses the global `window.katex` loaded via CDN (see useKatex hook).
// Canonical usage is children (<Eq>{"..."}</Eq>); the `m` prop is accepted as an
// alias because chat-authored augmentations historically used <Eq m={"..."}/> —
// without the alias those render blank.
export function Eq({ children, m, display = true }) {
  const latex = children ?? m ?? "";
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.katex) {
      try {
        window.katex.render(latex, ref.current, { displayMode: display, throwOnError: false, trust: true });
      } catch (e) { ref.current.textContent = latex; }
    }
  }, [latex, display]);
  return display ? <div className="eq-block" data-latex={latex}><span ref={ref} /></div> : <span ref={ref} className="eq-inline" data-latex={latex} />;
}

export function M({ children }) { return <Eq display={false}>{children}</Eq>; }
