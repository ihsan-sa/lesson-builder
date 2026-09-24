// The sample lesson section for <GeoGebraGraph>: two figures a student learns
// more from by moving than by looking at. It is the fixture tests/geogebra
// drives, and the worked example references/geogebra.md points authors at.
//
// ?bad=1 adds a third figure with a command GeoGebra rejects, so the check can
// see the rejection named under the figure rather than a blank applet.
import { useMemo, useState } from "react";
import { STYLES, Eq, M, P, Section, KeyConcept, GeoGebraGraph, useKatex } from "@core";

// Drag P round the circle: the angle APB stays half the central angle AOB.
// P = Point(c) is free on the circle; Point(c, t) would pin it. angP and
// angO are what the check reads back.
const INSCRIBED = [
  "c = Circle((0, 0), 3)",
  "O = (0, 0)",
  "A = (3; -30°)",
  "B = (3; 60°)",
  "P = Point(c)",
  "SetCoords(P, -2.12, -2.12)",
  "SetFixed(O, true)",
  "SetFixed(A, true)",
  "SetFixed(B, true)",
  "pa = Segment(P, A)",
  "pb = Segment(P, B)",
  "oa = Segment(O, A)",
  "ob = Segment(O, B)",
  "angP = Angle(A, P, B)",
  "angO = Angle(A, O, B)",
  "SetColor(angO, \"#c0392b\")",
  "ShowLabel(O, true)",
  "ShowLabel(A, true)",
  "ShowLabel(B, true)",
  "ShowLabel(P, true)",
  "ZoomIn(-4, -4, 4, 4)",
  // After any ZoomIn: a phone's tall figure would otherwise draw the circle
  // as an ellipse.
  "SetAxesRatio(1, 1)",
];

// A saddle: along x it curves up, along y down, so the origin is a
// critical point that is neither a maximum nor a minimum. Rotate it.
const SADDLE = [
  "f(x, y) = (x^2 - y^2) / 4",
  "S = (0, 0, 0)",
  "SetFixed(S, true)",
];

const BAD = ["g(x) = sin(x", "h(x) = x^2"];

// onReady hands over each applet's API. Here it is parked on window for the
// check to drive; a lesson would use it to read or set the figure's values.
const expose = mid => api => { (window.__ggb ||= {})[mid] = api; };

export default function LessonApp() {
  const [theme, setTheme] = useState("light");
  const katexReady = useKatex();
  const bad = useMemo(() => new URLSearchParams(window.location.search).has("bad"), []);
  if (!katexReady) return (<><style>{STYLES}</style><p>Loading KaTeX...</p></>);
  return (
    <div className={`theme-${theme}`} style={{ minHeight: "100vh", background: "var(--bg-main)", color: "var(--text-primary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{STYLES}</style>
      <div className="header">
        <div><h1>GeoGebra Demo</h1><p>Figures the student moves.</p></div>
        <button className="theme-toggle-btn" onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
      <div className="lesson-body">
        <Section title="The inscribed angle">
          <P>
            Fix two points <M>{"A"}</M> and <M>{"B"}</M> on a circle with centre <M>{"O"}</M>.
            Any third point <M>{"P"}</M> on the major arc sees the chord <M>{"AB"}</M> under
            the same angle, and that angle is half the central one:
          </P>
          <Eq>{"\\angle APB = \\tfrac{1}{2}\\,\\angle AOB"}</Eq>
          <P>Drag <M>{"P"}</M> round the circle and watch <M>{"\\angle APB"}</M> stay put.</P>
          <GeoGebraGraph view="geometry" commands={INSCRIBED} height={380} mid="inscribed-angle" onReady={expose("inscribed-angle")}/>
          <KeyConcept label="Why a moving figure">
            A single drawing shows one position of <M>{"P"}</M>, and the student has to take it on
            trust that the angle does not change. Moving it is the proof by experiment.
          </KeyConcept>
        </Section>
        <Section title="A saddle point">
          <P>
            The surface <M>{"z = (x^2 - y^2)/4"}</M> has zero gradient at the origin, yet the
            origin is neither a peak nor a pit. Rotate the figure until you see both.
          </P>
          <GeoGebraGraph view="3d" commands={SADDLE} height={380} mid="saddle" onReady={expose("saddle")}/>
        </Section>
        {bad && (
          <Section title="Negative control">
            <GeoGebraGraph commands={BAD} height={240} mid="bad-command" onReady={expose("bad-command")}/>
          </Section>
        )}
      </div>
    </div>
  );
}
