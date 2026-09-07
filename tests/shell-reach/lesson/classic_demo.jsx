// The pre-shell lesson shape, as the 39 classic lessons have it: the lesson
// injects `STYLES` from @core/chat/chat.css.js itself, draws its own header,
// its own DARK button and its own tab bar, and mounts <Chatbot> at the end.
// Nothing here names LessonShell.
//
// lesson/shelled_demo.jsx is this same lesson with one difference — its body is
// wrapped in <LessonShell>. That is what makes check.cjs's positive case a
// control for its negative one: the two bundles differ only by the shell.
import { useState } from "react";
import { Chatbot, P, Section, STYLES, routeLessonContext } from "@core";

const TOPICS = [
  {
    id: "intro",
    tab: "Intro",
    title: "Shell reach demo",
    sections: ["About"],
    content: () => (
      <Section title="About">
        <P>Single-topic scratch lesson for the shell-reach check.</P>
      </Section>
    ),
  },
];

const TOPIC_CONTEXT = { intro: "A placeholder topic for the shell-reach check." };
const LESSON_CONTEXT = "A one-topic scratch lesson used to measure whether LessonShell reaches a classic lesson's bundle.";
const GRAPH_SCHEMA = { params: {} };

function LessonApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [theme, setTheme] = useState("dark");
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

  return (
    <div className={`theme-${theme} ${chatOpen ? "ctx-active" : ""}`} style={{ minHeight: "100vh" }}>
      <style>{STYLES}</style>
      <div className="header">
        <div><h1>DEMO 101 -- Shell Reach Demo</h1></div>
        <button className="theme-toggle-btn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
      <div className="tab-bar">
        {TOPICS.map((t, i) => (
          <button key={t.id} className={`tab-btn ${i === activeIdx ? "active" : ""}`} onClick={() => setActiveIdx(i)}>{t.tab}</button>
        ))}
      </div>
      <div className="content-area">{active.content()}</div>
      <Chatbot
        courseCode="DEMO 101"
        courseName="Shell Reach Demo"
        lessonContext={LESSON_CONTEXT}
        topicContext={TOPIC_CONTEXT}
        lessonFile="src/shell_reach_demo.jsx"
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
    </div>
  );
}

export default LessonApp;
