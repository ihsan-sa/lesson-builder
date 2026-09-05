// Scratch lesson used to validate resume-metadata (ROADMAP P0 #5): mirrors
// the shape references/template.md prescribes (TOPICS / TOPIC_CONTEXT /
// LESSON_CONTEXT / GRAPH_SCHEMA) just enough to mount <LessonShell> and
// <Chatbot> for real, since the shipped placeholder renders nothing.
import { useState } from "react";
import { LessonShell, Chatbot, P, Section, routeLessonContext } from "@core";

const TOPICS = [
  {
    id: "intro",
    title: "Resume demo",
    sections: ["About"],
    content: () => (
      <Section title="About">
        <P>Single-topic scratch lesson for the resume-metadata check.</P>
      </Section>
    ),
  },
];

const TOPIC_CONTEXT = { intro: "A placeholder topic for the resume-metadata check." };
const LESSON_CONTEXT = "A one-topic scratch lesson used to validate chat session resume.";
const GRAPH_SCHEMA = { params: {} };

function LessonApp() {
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

  return (
    <LessonShell
      courseCode="DEMO 101"
      courseName="Resume Metadata Demo"
      lessonTitle="Resume Metadata Demo"
      topics={TOPICS}
      activeIdx={activeIdx}
      onSelectTopic={setActiveIdx}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
      tutor={
        <Chatbot
          courseCode="DEMO 101"
          courseName="Resume Metadata Demo"
          lessonContext={LESSON_CONTEXT}
          topicContext={TOPIC_CONTEXT}
          lessonFile="src/resume_demo.jsx"
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
