import { useEffect, useState } from "react";

// Loads KaTeX via CDN. Returns `katexReady` once the script has loaded.
// Lesson components should gate math rendering on this flag.
export function useKatex() {
  const [katexReady, setKatexReady] = useState(false);
  useEffect(() => {
    if (window.katex) { setKatexReady(true); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js";
    script.onload = () => setKatexReady(true);
    document.head.appendChild(script);
    return () => { link.remove(); script.remove(); };
  }, []);
  return katexReady;
}
