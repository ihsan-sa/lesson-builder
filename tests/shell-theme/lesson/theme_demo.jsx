// Scratch lesson used to demonstrate the shell's dark/light switch in a real
// browser. Built the way references/template.md prescribes for a lesson WITH
// graphs: the lesson holds the theme, LessonShell renders the switch and calls
// onThemeChange, and G is rebound before the render that reads it — which is
// the only thing that makes an SVG follow, since graph colours are JS values
// and not CSS variables.
//
// It mounts <Chatbot> for real because the pop-out button lives behind the
// tutor gate (LessonShell: tutorEnabled = !!tutor && TUTOR_ENABLED), and the
// detached pop-out window is one of the parts that has to follow the theme.
// The panel never talks to a proxy here; it only has to paint.
import { useState } from "react";
import { LessonShell, Chatbot, Eq, P, Section, THEMES_G, routeLessonContext } from "@core";

let G = THEMES_G.light;

// One inline SVG whose colours come from G, so the check has something on the
// page that CANNOT follow a class change and must follow a re-render instead.
function Trace() {
  return (
    <svg data-testid="trace" width="240" height="90" viewBox="0 0 240 90">
      <rect data-testid="trace-bg" x="0" y="0" width="240" height="90" fill={G.bg} />
      <path data-testid="trace-curve" d="M8 78 C 70 78, 90 12, 232 12" fill="none" stroke={G.gold} strokeWidth="2" />
    </svg>
  );
}

const TOPICS = [
  {
    id: "switch",
    title: "The switch",
    sections: ["Both palettes"],
    content: () => (
      <>
        <Section title="Both palettes">
          <P>Prose, an equation card and an SVG, so the check can read one of each.</P>
          <Eq>{"E = mc^2"}</Eq>
          <Trace />
        </Section>
      </>
    ),
  },
];

const TOPIC_CONTEXT = { switch: "A placeholder topic for the theme check." };
const LESSON_CONTEXT = "A one-topic scratch lesson used to demonstrate the shell's dark/light switch.";
const GRAPH_SCHEMA = { params: {} };

function LessonApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [contextSnippets, setContextSnippets] = useState([]);
  const [theme, setTheme] = useState("light");
  G = THEMES_G[theme];
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
      courseName="Theme Demo"
      lessonTitle="Theme Demo"
      topics={TOPICS}
      activeIdx={activeIdx}
      onSelectTopic={setActiveIdx}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
      theme={theme}
      onThemeChange={setTheme}
      tutor={
        <Chatbot
          courseCode="DEMO 101"
          courseName="Theme Demo"
          lessonContext={LESSON_CONTEXT}
          topicContext={TOPIC_CONTEXT}
          lessonFile="src/theme_demo.jsx"
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
