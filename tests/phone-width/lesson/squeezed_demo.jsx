// The negative control: a lesson that IS broken, so the collapse check can be
// shown to catch a break rather than only to stay quiet.
//
// It carries each squeezable part twice — once laid out normally ("kept") and
// once squeezed to nothing ("squeezed") — so one page proves both halves: the
// check names every squeezed part and names none of the kept ones. Every part's
// text says which it is, and check.cjs asserts on that.
//
// THE MECHANISM. A flex child with `min-width: 0` that is squeezed collapses to
// ZERO width instead of overflowing its parent. Nothing overflows, so the page
// never scrolls sideways and a page-level overflow check stays green while the
// part is not on screen at all. `.eq-body` carries exactly that pair of
// declarations, which is how both shell lessons rendered their equations 0px
// wide at 390px before #24 while horizontal overflow measured 0px in that build
// and in the fixed one alike.
//
// Pre-shell shape, like lesson/classic_demo.jsx: the squeeze is in this file's
// own inline styles, so what it demonstrates does not depend on either sheet.
import { STYLES, Eq, P, Section, useKatex } from "@core";
import { Figure, Table, Code } from "./parts.jsx";

// A row whose first child takes the whole width. Anything after it is a flex
// child with nothing left to have.
const ROW = { display: "flex", alignItems: "flex-start" };
const HOG = { flex: "0 0 100%" };
const SQUEEZED = { flex: "1 1 0", minWidth: 0, overflowX: "auto" };

export default function LessonApp() {
  const katexReady = useKatex();
  if (!katexReady) return (<><style>{STYLES}</style><p>Loading KaTeX...</p></>);
  return (
    <div className="theme-dark" style={{ minHeight: "100vh", background: "var(--bg-main)", color: "var(--text-primary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{STYLES}</style>
      <div className="lesson-body">
        <Section title="Laid out">
          <P>Each part with the width it asks for. None of these may be named.</P>
          <Eq>{"E_{\\text{kept}} = mc^2"}</Eq>
          <Figure what="kept" />
          <Table what="kept" />
          <Code what="kept" />
        </Section>
        <Section title="Squeezed">
          <P>The same four parts, each a flex child of a row already full.</P>
          <div style={ROW}>
            <div style={HOG} />
            <div style={SQUEEZED}><Eq>{"E_{\\text{squeezed}} = mc^2"}</Eq></div>
          </div>
          <div style={ROW}>
            <div style={HOG} />
            <div style={SQUEEZED}><Figure what="squeezed" /></div>
          </div>
          <div style={ROW}>
            <div style={HOG} />
            <div style={SQUEEZED}><Table what="squeezed" /></div>
          </div>
          <div style={ROW}>
            <div style={HOG} />
            <div style={SQUEEZED}><Code what="squeezed" /></div>
          </div>
        </Section>
      </div>
    </div>
  );
}
