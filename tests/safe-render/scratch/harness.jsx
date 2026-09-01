import React from "react";
import ReactDOM from "react-dom/client";
import { useKatex, STYLES } from "@core";
import { ChatBubble } from "@core/chat/ChatBubble.jsx";
import { processResponse } from "@core/chat/processResponse.js";

window.__lint = [];
window.__xss = [];
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const BENIGN = `## Half-life
The number of nuclei left is \\(N = N_0 e^{-\\lambda t}\\), so **half** remain after
\\[ t_{1/2} = \\frac{\\ln 2}{\\lambda} \\]
- one list item with \`inline code\`
- another item

| isotope | half-life |
|---|---|
| C-14 | 5730 y |
| I-131 | 8 d |

\`\`\`python
N = N0 * 0.5 ** (t / half_life)
\`\`\`
![one pixel](${PNG})
<<DEMO title="Decay curve">>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="240" height="120"><title>Decay curve</title><path d="M10 10 C 60 10, 60 90, 190 90" fill="none" stroke="#48f" stroke-width="2"/><text x="20" y="95" font-size="10">t</text></svg>
<<END_DEMO>>
<<DEMO title="No viewBox">>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50"/></svg>
<<END_DEMO>>
<<SOURCES>>
- [Wikipedia: Half-life](https://en.wikipedia.org/wiki/Half-life)
<<END_SOURCES>>`;

const XSS = `Try this: <img src="x" onerror="window.__xss.push('img')">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.__xss.push('svg')"><a href="javascript:window.__xss.push('js')"><text y="8">x</text></a><foreignObject><body onload="window.__xss.push('fo')"/></foreignObject></svg>
<<SOURCES>>
- [evil](javascript:window.__xss.push('src'))
<<END_SOURCES>>`;

function Harness() {
  const ready = useKatex();
  if (!ready) return <div id="waiting">loading katex</div>;
  const onError = (type, info) => window.__lint.push({ type, ...info });
  const benign = processResponse(BENIGN, { onError }).display;
  const xss = processResponse(XSS, { onError }).display;
  return (
    <div style={{ width: 640 }}>
      <style>{STYLES}</style>
      <div id="benign"><ChatBubble text={benign} role="assistant" streaming={false} onReplyBlock={() => {}} /></div>
      <div id="xss"><ChatBubble text={xss} role="assistant" streaming={false} onReplyBlock={() => {}} /></div>
      <div id="done" />
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<Harness />);
