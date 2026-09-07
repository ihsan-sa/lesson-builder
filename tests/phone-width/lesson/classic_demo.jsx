// Scratch lesson used to measure phone-width geometry OUTSIDE LessonShell —
// the shape 39 of the 41 lessons have: the lesson injects STYLES itself, wraps
// its topic in `.lesson-body`, and has none of the shell's markup. It is
// therefore the only one of the two demos that shows what chat/chat.css.js does
// on its own, with no SHELL_STYLES over the top.
//
// Same three equation widths as lesson/shell_demo.jsx (short, wide, captioned),
// so the two cases are comparable.
import { useState } from "react";
import { STYLES, Eq, M, P, Section, useKatex } from "@core";
import { Figure, Table, Code } from "./parts.jsx";

const TOPICS = [
  {
    id: "widths",
    tab: "Widths",
    title: "1. Equation widths",
    content: () => (
      <div className="lesson-body">
        <Section title="Short">
          <P>A short display equation, the easiest case for the column.</P>
          <Eq>{"E = mc^2"}</Eq>
          <P>
            Inline math such as <M>{"\\hbar"}</M> rides the paragraph and takes no rail.
          </P>
        </Section>
        <Section title="Long">
          <P>A wide one, and one with a caption riding the border.</P>
          <Eq>{"\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi} \\quad \\text{for all real } x"}</Eq>
          <Eq label="TIME-DEPENDENT FORM">{"i\\hbar \\partial_t \\psi = H\\psi"}</Eq>
        </Section>
        <Section title="Parts that are not equations">
          <P>A figure, a table and a code block: an equation is not the only
            thing a narrow column can squeeze to nothing.</P>
          <Figure />
          <Table />
          <Code />
        </Section>
      </div>
    ),
  },
  {
    id: "second",
    tab: "Second",
    title: "2. A second topic",
    content: () => (
      <div className="lesson-body">
        <Section title="Why">
          <P>A second topic, so the tab bar has more than one tab.</P>
          <Eq>{"H\\psi_n = E_n \\psi_n"}</Eq>
        </Section>
      </div>
    ),
  },
];

export default function LessonApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [theme, setTheme] = useState("dark");
  const katexReady = useKatex();
  if (!katexReady) {
    return (
      <>
        <style>{STYLES}</style>
        <p>Loading KaTeX...</p>
      </>
    );
  }
  return (
    <div className={`theme-${theme}`} style={{ minHeight: "100vh", background: "var(--bg-main)", color: "var(--text-primary)", fontFamily: "'IBM Plex Sans', sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{STYLES}</style>
      <div className="header">
        <div>
          <h1>Phone Width Demo</h1>
          <p>A scratch lesson in the pre-shell shape.</p>
        </div>
        <button className="theme-toggle-btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
      <div className="tab-bar">
        {TOPICS.map((t, i) => (
          <button key={t.id} className={`tab-btn ${i === activeIdx ? "active" : ""}`} onClick={() => setActiveIdx(i)}>{t.tab}</button>
        ))}
      </div>
      {TOPICS[activeIdx].content()}
    </div>
  );
}
