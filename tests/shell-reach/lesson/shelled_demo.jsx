// lesson/classic_demo.jsx with one difference: the body is wrapped in
// <LessonShell>, so this lesson reaches the shell the way the two shell lessons
// in the lessons repo do. Same topics, same Chatbot, same props.
//
// It is the positive control for check.cjs: the markers the classic bundle must
// not contain are read out of THIS bundle, which must contain all of them. If
// the shell ever landed in a classic lesson's bundle, the classic cases would
// read exactly what this case reads here.
//
// It does not inject STYLES: LessonShell injects SHELL_STYLES instead, which is
// what a shell lesson does. The classic case asserts STYLES separately, on its
// own bundle.
import { useState } from "react";
import { LessonShell, Chatbot, P, Section, routeLessonContext } from "@core";

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
      courseName="Shell Reach Demo"
      lessonTitle="Shell Reach Demo"
      topics={TOPICS}
      activeIdx={activeIdx}
      onSelectTopic={setActiveIdx}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
      tutor={
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
      }
    >
      {active.content()}
    </LessonShell>
  );
}

export default LessonApp;
