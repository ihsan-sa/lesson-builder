import { useEffect, useRef } from "react";

// KaTeX math renderer. Uses the global `window.katex` loaded via CDN (see useKatex hook).
export function Eq({ children, display = true }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.katex) {
      try {
        window.katex.render(children, ref.current, { displayMode: display, throwOnError: false, trust: true });
      } catch (e) { ref.current.textContent = children; }
    }
  }, [children, display]);
  return display ? <div className="eq-block"><span ref={ref} /></div> : <span ref={ref} className="eq-inline" />;
}

export function M({ children }) { return <Eq display={false}>{children}</Eq>; }
