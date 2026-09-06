// A lesson small enough to read and shaped exactly like a real one: two graph components, a
// capitalised lesson-local helper, a helper with one user, a helper with two, a helper with none,
// a base64 image constant, a static image, a manim video, and an interactive demo.
import React, { useState } from "react";
import {
  LessonShell, Chatbot, Eq, M, P, Section, KeyConcept, RefImg,
  LiveGraph, InteractiveDemo, Slider, CollapsibleBlock,
  useKatex, STYLES,
} from "@core";

const IMG = import.meta.env.BASE_URL + "images/";
const VID = import.meta.env.BASE_URL + "videos/";

// The matplotlib reference figure, inlined. Truncated here; a real one is ~200 KB.
const IMG_SPECTRUM_REFERENCE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const LESSON_CONTEXT = `Wave packets: group velocity, dispersion, and the spectrum that builds them.`;

const DEFAULT_GRAPH_PARAMS = {
  waveGraph: { k0: 4, sigma: 1.2, showEnvelope: true },
  spectrumGraph: { width: 2, peak: 4, logScale: false },
};

export const GRAPH_SCHEMA = {
  waveGraph: {
    k0: { type: "float", min: 0.5, max: 12 },
    sigma: { type: "float", min: 0.2, max: 4 },
    showEnvelope: { type: "bool" },
  },
  spectrumGraph: {
    width: { type: "float", min: 0.2, max: 6 },
    peak: { type: "float", min: 0.5, max: 12 },
    logScale: { type: "bool" },
  },
};

// Used by WaveGraph and by nothing else: removing WaveGraph strands it.
function polarPath(r, theta) {
  return `${(r * Math.cos(theta)).toFixed(3)},${(r * Math.sin(theta)).toFixed(3)}`;
}

// Used by both graphs: removing either one leaves the other holding it.
function axisTicks(min, max, n) {
  const step = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + i * step);
}

// Nobody calls this. It is the genuinely unused helper.
function normalizeGain(values) {
  const peak = Math.max(...values.map(Math.abs));
  return peak === 0 ? values : values.map((v) => v / peak);
}

// Capitalised, returns JSX, and is NOT a graph: no `params` prop. A grep for a capitalised
// function declaration classifies this as a graph component; the parser does not.
function HWQuestion({ n, children }) {
  return (
    <div className="hw-question">
      <span className="hw-number">Q{n}</span>
      {children}
    </div>
  );
}

function WaveGraph({ params, mid = "" }) {
  const p = { ...DEFAULT_GRAPH_PARAMS.waveGraph, ...params };
  const ticks = axisTicks(-6, 6, 12);
  const pts = ticks.map((x) => polarPath(Math.exp(-((x / p.sigma) ** 2)), p.k0 * x));
  return (
    <div className="eq-block">
      <svg viewBox="0 0 400 240" role="img" aria-label={`wave packet ${mid}`}>
        <polyline points={pts.join(" ")} fill="none" stroke="currentColor" />
        {p.showEnvelope && <path d="M 0 120 L 400 120" stroke="currentColor" opacity="0.3" />}
      </svg>
    </div>
  );
}

function SpectrumGraph({ params, mid = "" }) {
  const p = { ...DEFAULT_GRAPH_PARAMS.spectrumGraph, ...params };
  const ticks = axisTicks(0, 10, 20);
  const bars = ticks.map((k) => Math.exp(-(((k - p.peak) / p.width) ** 2)));
  return (
    <div className="eq-block">
      <svg viewBox="0 0 400 240" role="img" aria-label={`spectrum ${mid}`}>
        {bars.map((h, i) => (
          <rect key={i} x={i * 20} y={240 - h * 200} width="16" height={h * 200} />
        ))}
        {p.logScale && <text x="8" y="16">log</text>}
      </svg>
    </div>
  );
}

const TOPICS = [
  {
    id: "topic-1",
    tab: "Packets",
    title: "A packet is a sum of plane waves",
    subtitle: "Superposition",
    blurb: "Adding plane waves of nearby wavenumbers localises the disturbance.",
    content: (gp, renderId, demo) => (
      <Section title="Building a packet">
        <P>
          A single plane wave fills all space. Summing waves whose wavenumbers cluster near
          <M>{"k_0"}</M> makes the crests cancel everywhere but one region:
        </P>
        <Eq>{"\\psi(x) = \\int A(k)\\, e^{i(kx - \\omega t)}\\, dk"}</Eq>
        <LiveGraph graphKey="waveGraph" renderId={renderId}>
          <WaveGraph params={gp.waveGraph} />
        </LiveGraph>
        <video src={VID + "wave-packet.mp4"} controls muted />
        <HWQuestion n={1}>
          Sketch the packet when <M>{"\\sigma"}</M> is halved.
        </HWQuestion>
        {demo}
      </Section>
    ),
  },
  {
    id: "topic-2",
    tab: "Spectrum",
    title: "The spectrum sets the width",
    subtitle: "Fourier pairs",
    blurb: "A broad spectrum makes a narrow packet, and the other way round.",
    content: (gp, renderId) => (
      <Section title="Reading the spectrum">
        <KeyConcept>Width in k and width in x are reciprocal.</KeyConcept>
        <LiveGraph graphKey="spectrumGraph" renderId={renderId}>
          <SpectrumGraph params={gp.spectrumGraph} />
        </LiveGraph>
        <img src={IMG + "spectrum-figure.png"} alt="Measured spectrum of a laser pulse" />
        <RefImg src={IMG_SPECTRUM_REFERENCE} caption="Reference spectrum" />
      </Section>
    ),
  },
];

const TOPIC_CONTEXT = {
  "topic-1": `Superposition of plane waves; the envelope and its group velocity.`,
  "topic-2": `The Fourier pair between spectral width and packet width.`,
};

function LessonApp() {
  const katexReady = useKatex();
  const [activeIdx, setActiveIdx] = useState(0);
  const [graphParams, setGraphParams] = useState(DEFAULT_GRAPH_PARAMS);
  const [graphRenderId, setGraphRenderId] = useState(0);
  const [sigma, setSigma] = useState(1.2);
  const [showEnvelope, setShowEnvelope] = useState(true);

  const demo = (
    <InteractiveDemo title="Wave Packet Explorer">
      <Slider label="Envelope width" value={sigma} min={0.2} max={4} step={0.1} onChange={setSigma} />
      <Slider label="Envelope" value={showEnvelope ? 1 : 0} min={0} max={1} step={1}
              onChange={(v) => setShowEnvelope(v === 1)} />
      <WaveGraph params={{ ...graphParams.waveGraph, sigma, showEnvelope }} mid="demo" />
    </InteractiveDemo>
  );

  return (
    <LessonShell
      styles={STYLES}
      topics={TOPICS}
      activeIdx={activeIdx}
      onSelect={setActiveIdx}
      katexReady={katexReady}
      render={(t) => t.content(graphParams, graphRenderId, demo)}
    >
      <Chatbot
        courseCode="PHYS 201"
        courseName="Waves and Optics"
        lessonContext={LESSON_CONTEXT}
        topicContext={TOPIC_CONTEXT}
        lessonFile="src/sample_lesson.jsx"
        graphSchema={GRAPH_SCHEMA}
        graphRenderId={graphRenderId}
        onEditGraph={(edits) => {
          setGraphParams((prev) => ({ ...prev, ...edits }));
          setGraphRenderId((id) => id + 1);
        }}
      />
    </LessonShell>
  );
}

export default LessonApp;
