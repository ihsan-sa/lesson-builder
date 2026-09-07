// The same scratch lesson as theme_demo.jsx with ONE difference: it passes the shell
// neither `theme` nor `onThemeChange`, so the shell owns the choice itself. That is the
// UNCONTROLLED path — the one both lessons that ship on the shell are on, and the one
// nothing exercised. run.sh builds this alongside the controlled body and browser.cjs
// case 5 presses the switch on it.
//
// It is also the trap references/template.md:868 names: it draws an SVG from THEMES_G,
// so a class swap cannot reach those colours and nothing re-renders them. The DARK
// button gives a dark page with light-palette graphs on it. Deliberate — case 5 in
// browser.cjs reads that off the page, and case 5 in check.cjs is the static check that
// flags this file and clears theme_demo.jsx. Do not "fix" it by adding the props.
//
// No <Chatbot>: the pop-out is theme_demo.jsx's case, and the switch sits outside the
// tutor gate, so it is rendered here without one.
import { useState } from "react";
import { LessonShell, Eq, P, Section, THEMES_G } from "@core";

let G = THEMES_G.light;

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

function LessonApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const active = TOPICS[activeIdx];

  return (
    <LessonShell
      courseCode="DEMO 101"
      courseName="Theme Demo"
      lessonTitle="Theme Demo (uncontrolled)"
      topics={TOPICS}
      activeIdx={activeIdx}
      onSelectTopic={setActiveIdx}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
    >
      {active.content()}
    </LessonShell>
  );
}

export default LessonApp;
