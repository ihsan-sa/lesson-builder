// Scratch lesson used to validate the KaTeX CDN fallback. Mirrors the shape
// references/template.md prescribes (TOPICS / TOPIC_CONTEXT / LESSON_CONTEXT /
// GRAPH_SCHEMA / the useKatex loading gate) so test_lesson.cjs and the
// Playwright run exercise the real thing.
import { useState } from "react";
import {
  LessonShell, Chatbot, STYLES, useKatex,
  Eq, M, P, Section, KeyConcept, routeLessonContext,
} from "@core";

const TOPICS = [
  {
    id: "wave",
    title: "The wave equation",
    sections: ["Statement", "Reading it"],
    content: () => (
      <>
        <Section title="Statement">
          <P>
            The time-dependent Schrodinger equation relates the rate of change of a
            state to the energy operator acting on it.
          </P>
          <Eq label="TIME-DEPENDENT FORM">{"i\\hbar \\partial_t \\psi = H\\psi"}</Eq>
          <P>
            Here <M>{"\\hbar"}</M> is the reduced Planck constant and <M>{"H"}</M> is
            the Hamiltonian.
          </P>
        </Section>
        <Section title="Reading it">
          <KeyConcept title="What the equation says">
            The Hamiltonian generates time translation of the state.
          </KeyConcept>
          <Eq>{"\\frac{d}{dx}\\left( x^2 + 1 \\right) = 2x"}</Eq>
        </Section>
      </>
    ),
  },
  {
    id: "energy",
    title: "Energy eigenstates",
    sections: ["Eigenvalue problem"],
    content: () => (
      <>
        <Section title="Eigenvalue problem">
          <P>Stationary states solve the time-independent problem.</P>
          <Eq label="EIGENVALUE FORM">{"H\\psi_n = E_n \\psi_n"}</Eq>
        </Section>
      </>
    ),
  },
];

const TOPIC_CONTEXT = {
  wave: "The time-dependent Schrodinger equation and how to read each factor.",
  energy: "Energy eigenstates as solutions of the time-independent equation.",
};

const LESSON_CONTEXT = `A two-topic scratch lesson used to validate that the
lesson body stays usable when the KaTeX CDN cannot be reached.`;

const GRAPH_SCHEMA = { params: {} };

function LessonApp() {
  const katexReady = useKatex();
  const [activeIdx, setActiveIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [contextSnippets, setContextSnippets] = useState([]);
  const active = TOPICS[activeIdx];
  const handleClearSnippet = (i) => setContextSnippets((s) => s.filter((_, k) => k !== i));
  const handleClearAllSnippets = () => setContextSnippets([]);
  const addSnippet = (text, source) => {
    const clean = String(text).replace(/\s+/g, " ").trim();
    if (!clean || clean.length < 3) return;
    if (routeLessonContext(clean, source)) return;
    setContextSnippets((prev) => (prev.some((s) => s.text === clean) ? prev : [...prev, { text: clean, source }]));
  };

  // KaTeX loads from CDN on mount. Gate the whole app until it is ready so
  // math blocks do not flash unrendered source.
  if (!katexReady) {
    return (
      <>
        <style>{STYLES}</style>
        <div
          className="theme-light"
          style={{ minHeight: "100vh", background: "var(--canvas)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <p style={{ color: "var(--ink-4)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
            Loading KaTeX...
          </p>
        </div>
      </>
    );
  }

  return (
    <LessonShell
      courseCode="DEMO 101"
      courseName="KaTeX Fallback Demo"
      lessonTitle="KaTeX Fallback Demo"
      topics={TOPICS}
      activeIdx={activeIdx}
      onSelectTopic={setActiveIdx}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
      tutor={
        <Chatbot
          courseCode="DEMO 101"
          courseName="KaTeX Fallback Demo"
          lessonContext={LESSON_CONTEXT}
          topicContext={TOPIC_CONTEXT}
          lessonFile="src/katex_demo.jsx"
          graphSchema={GRAPH_SCHEMA}
          topicId={active.id}
          topicTitle={active.title}
          contextSnippets={contextSnippets}
          onClearSnippet={handleClearSnippet}
          onClearAllSnippets={handleClearAllSnippets}
          addSnippet={addSnippet}
          graphParams={{}}
          graphRenderId={0}
          open={chatOpen}
          setOpen={setChatOpen}
        />
      }
    >
      {active.content()}
    </LessonShell>
  );
}

export default LessonApp;
