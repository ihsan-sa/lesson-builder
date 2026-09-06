import React, { useState } from 'react';
import { InteractiveDemo, LiveGraph } from '@core';

// The shipped teaching spec: what each topic is for and the arc a reviewer judges its media
// against. It lives in the lesson, so it is the same ref in every run.
const TOPIC_CONTEXT = {
  '1': {
    objective: 'predict how damping changes a waveform',
    arc: 'amplitude decays; frequency does not',
  },
};

const DEFAULT_GRAPH_PARAMS = {
  waveGraph: { amplitude: 1, damping: 0.2 },
  spectrumGraph: { peak: 540 },
};

// Shared by both graphs: the tick positions along an axis.
function axisTicks(min, max, count) {
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + i * step);
}

function polarPath(radius, turns) {
  return `M 0 0 L ${radius} ${turns}`;
}

function WaveGraph({ params, mid = '' }) {
  const ticks = axisTicks(0, 10, 5);
  return (
    <svg id={mid} viewBox="0 0 320 180">
      <path d={polarPath(params.amplitude * 80, 3)} />
      {ticks.map((t) => (
        <line key={t} x1={t} y1="0" x2={t} y2="180" />
      ))}
    </svg>
  );
}

function SpectrumGraph({ params, mid = '' }) {
  const ticks = axisTicks(400, 700, 6);
  return (
    <svg id={mid} viewBox="0 0 320 180">
      {ticks.map((t) => (
        <line key={t} x1={t} y1="0" x2={t} y2="180" stroke={t === params.peak ? 'red' : 'grey'} />
      ))}
    </svg>
  );
}

export default function LessonApp() {
  const [damping, setDamping] = useState(0.2);
  return (
    <article>
      <LiveGraph graphKey="waveGraph">
        <WaveGraph params={DEFAULT_GRAPH_PARAMS.waveGraph} mid="m3" />
      </LiveGraph>
      <LiveGraph graphKey="spectrumGraph">
        <SpectrumGraph params={DEFAULT_GRAPH_PARAMS.spectrumGraph} mid="m4" />
      </LiveGraph>
      <InteractiveDemo title="Damping sandbox">
        <input type="range" value={damping} onChange={(e) => setDamping(+e.target.value)} />
      </InteractiveDemo>
    </article>
  );
}
