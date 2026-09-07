// Scratch lesson used to measure phone-width geometry inside LessonShell.
// Carries the TOPICS shape references/template.md prescribes, and no more: this
// lesson mounts <LessonShell> for real (the shipped placeholder renders
// nothing, and geometry measured on nothing proves nothing) but never mounts a
// tutor, so it needs none of the context a <Chatbot> would be given.
//
// The equations are deliberately of three widths: one that fits any column, one
// long enough to need the whole width of a phone, and one carrying a label, so
// the measurement sees a narrow case, a wide case and the captioned case.
import { useState } from "react";
import { LessonShell, Eq, M, P, Section, useKatex } from "@core";

const TOPICS = [
  {
    id: "widths",
    title: "Equation widths",
    sections: ["Short", "Long"],
    content: () => (
      <>
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
      </>
    ),
  },
  {
    id: "second",
    title: "A second topic",
    sections: ["Why"],
    content: () => (
      <>
        <Section title="Why">
          <P>A second topic so the contents rail has more than one row to list.</P>
          <Eq>{"H\\psi_n = E_n \\psi_n"}</Eq>
        </Section>
      </>
    ),
  },
];


export default function LessonApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const katexReady = useKatex();
  const active = TOPICS[activeIdx];
  // The lesson gates its first paint on KaTeX settling, exactly as a real one
  // does; the measurement waits for the article rather than for this element.
  if (!katexReady) return <p>Loading KaTeX...</p>;
  return (
    <LessonShell
      courseCode="DEMO 101"
      courseName="Phone Width Demo"
      lessonTitle="Phone Width Demo"
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
