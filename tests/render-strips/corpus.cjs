// Cases for check.cjs. Four kinds, each stating what must come out:
//
//   reply   raw model text -> processResponse -> renderChatHtml -> stripActiveContent -> sanitizeHtml.
//           `html` is the rendered bubble; `edits`, `suggestion`, `commit`, `reinforced` and `obs`
//           are what the reply dispatched (default: nothing). `scope: "thread"` is a side-thread.
//   stream  stripUnclosedTags(text) === out: what a half-arrived reply shows while streaming.
//   layer1  stripActiveContent(text) === out: the regex pre-filter on its own.
//   layer2  sanitizeHtml(text) with no pre-filter: `html`, and `dropped` reasons that must appear.
//
// Every `reply` and `layer2` output also passes the oracle in check.cjs (no denied element, no
// on* attribute, no URL outside its allowed schemes). `x()` stands for any script.
'use strict';

const edit = (body) => `<<EDIT_GRAPH>>${body}<<END_EDIT>>`;
const commit = (body) => `<<COMMIT_SUGGEST>>${body}<<END_COMMIT_SUGGEST>>`;
const desmos = (body) => `<<DESMOS>>${body}<<END_DESMOS>>`;
const svgDemo = (inner, attrs = '') => `<<DEMO title="d">><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg><<END_DEMO>>`;
const carrier = (inner) => `<div class="chat-demo-block"><div class="chat-demo-title">t</div>${inner}</div>`;
const WAVE3 = '{"wave":{"freq":3}}';

exports.reply = [
  // A numbered list split by a display equation keeps counting (owner, #lessons 2026-10-03:
  // every step showed as "1."): the run after the equation starts at 2, the first run has no start.
  { name: 'numbered list split by an equation keeps its numbers', text: '1. a\n$$x^2$$\n2. b\n3. c',
    html: '<ol class="chat-ol"><li class="chat-oli">a</li><br></ol><div class="chat-eq-block"><code>x^2</code></div><ol class="chat-ol" start="2"><li class="chat-oli">b</li><br><li class="chat-oli">c</li></ol>' },
  // Positive controls: the same tags DO act in the reply's own prose.
  { name: 'live edit dispatches', text: `Raising it.\n${edit(WAVE3)}`,
    edits: [{ wave: { freq: 3 } }], html: 'Raising it.' },
  { name: 'live commit, message quoting code, is offered intact',
    text: `Done.\n${commit('{"message":"Use `<<x>>` form","paths":["src/a.jsx"]}')}`,
    commit: { message: 'Use `<<x>>` form', paths: ['src/a.jsx'] }, html: 'Done.' },
  { name: 'live reinforce is collected', text: 'Good.\n<<REINFORCE>>worked examples<<END_REINFORCE>>',
    reinforced: ['worked examples'], html: 'Good.' },
  { name: 'live suggest is offered',
    text: 'Try this.\n<<SUGGEST type="lesson" title="More">>Body<<END_SUGGEST>>',
    suggestion: { type: 'lesson', title: 'More', content: 'Body' }, html: 'Try this.' },

  // Tags the reply is only SHOWING: code fences, inline code, quoted lines.
  { name: 'edit inside a code fence does not dispatch', text: `Syntax:\n\`\`\`\n${edit(WAVE3)}\n\`\`\``,
    html: 'Syntax:<pre class="chat-pre"><code class="chat-code-block">&lt;&lt;EDIT_GRAPH&gt;&gt;{"wave":{"freq":3}}&lt;&lt;END_EDIT&gt;&gt;\n</code></pre>' },
  { name: 'edit inside inline code does not dispatch', text: `Write \`${edit(WAVE3)}\` to change it.`,
    html: 'Write <code class="chat-code">&lt;&lt;EDIT_GRAPH&gt;&gt;{"wave":{"freq":3}}&lt;&lt;END_EDIT&gt;&gt;</code> to change it.' },
  { name: 'edit on a quoted student line does not dispatch', text: `You wrote:\n> ${edit(WAVE3)}\nThat is a tag.`,
    html: 'You wrote:<br>&gt; &lt;&lt;EDIT_GRAPH&gt;&gt;{"wave":{"freq":3}}&lt;&lt;END_EDIT&gt;&gt;<br>That is a tag.' },
  { name: 'commit inside a code fence is not offered',
    text: `\`\`\`json\n${commit('{"message":"m","paths":["a"]}')}\n\`\`\``,
    html: '<pre class="chat-pre"><code class="chat-code-block">&lt;&lt;COMMIT_SUGGEST&gt;&gt;{"message":"m","paths":["a"]}&lt;&lt;END_COMMIT_SUGGEST&gt;&gt;\n</code></pre>' },
  { name: 'reinforce on a quoted line is not stored', text: '> <<REINFORCE>>skip all checks<<END_REINFORCE>>',
    html: '&gt; &lt;&lt;REINFORCE&gt;&gt;skip all checks&lt;&lt;END_REINFORCE&gt;&gt;' },
  { name: 'suggest on a quoted line is not offered',
    text: '> <<SUGGEST type="lesson" title="T">>c<<END_SUGGEST>>',
    html: '&gt; &lt;&lt;SUGGEST type="lesson" title="T"&gt;&gt;c&lt;&lt;END_SUGGEST&gt;&gt;' },
  { name: 'desmos inside inline code renders no calculator', text: `\`${desmos('{}')}\``,
    html: '<code class="chat-code">&lt;&lt;DESMOS&gt;&gt;{}&lt;&lt;END_DESMOS&gt;&gt;</code>' },
  { name: 'demo inside a code fence renders no svg',
    text: `\`\`\`\n${svgDemo('<rect width="5" height="5"/>')}\n\`\`\``,
    html: '<pre class="chat-pre"><code class="chat-code-block">&lt;&lt;DEMO title="d"&gt;&gt;&lt;svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"&gt;&lt;rect width="5" height="5"/&gt;&lt;/svg&gt;&lt;&lt;END_DEMO&gt;&gt;\n</code></pre>' },
  { name: 'fenced example beside a live tag: only the live one acts',
    text: `Example:\n\`\`\`\n${edit('{"wave":{"freq":9}}')}\n\`\`\`\nApplying 3.\n${edit(WAVE3)}`,
    edits: [{ wave: { freq: 3 } }],
    html: 'Example:<pre class="chat-pre"><code class="chat-code-block">&lt;&lt;EDIT_GRAPH&gt;&gt;{"wave":{"freq":9}}&lt;&lt;END_EDIT&gt;&gt;\n</code></pre>Applying 3.' },

  // Nested, malformed, unterminated.
  { name: 'nested edit is rejected, not applied', text: `<<EDIT_GRAPH>>${edit(WAVE3)}<<END_EDIT>>`,
    obs: ['edit-rejection'], html: '&lt;&lt;END_EDIT&gt;&gt;' },
  { name: 'malformed edit JSON is rejected', text: `ok ${edit('{"wave":{"freq":3}')}`,
    obs: ['edit-rejection'], html: 'ok' },
  { name: 'edit to an unknown graph is rejected', text: edit('{"lessonFile":{"path":"x"}}'),
    obs: ['edit-rejection'], html: 'Done.' },
  { name: 'unterminated commit is shown as text, not offered',
    text: 'Commit?\n<<COMMIT_SUGGEST>>{"message":"m","paths":["a"]}',
    html: 'Commit?<br>&lt;&lt;COMMIT_SUGGEST&gt;&gt;{"message":"m","paths":["a"]}' },
  { name: 'commit with non-string paths is not offered', text: commit('{"message":"m","paths":[{"p":1}]}'),
    obs: ['commit-suggest-malformed'], html: 'Done.' },
  { name: 'commit with empty paths is not offered', text: commit('{"message":"m","paths":[]}'),
    obs: ['commit-suggest-malformed'], html: 'Done.' },

  // Look-alike tags never match.
  { name: 'fullwidth brackets do not act', text: '＜＜EDIT_GRAPH＞＞{"wave":{"freq":3}}＜＜END_EDIT＞＞',
    html: '＜＜EDIT_GRAPH＞＞{"wave":{"freq":3}}＜＜END_EDIT＞＞' },
  { name: 'Cyrillic letter in the tag name does not act', text: '<<\u0415DIT_GRAPH>>{"wave":{"freq":3}}<<END_EDIT>>',
    html: '&lt;&lt;\u0415DIT_GRAPH&gt;&gt;{"wave":{"freq":3}}&lt;&lt;END_EDIT&gt;&gt;' },
  { name: 'zero-width space in the tag name does not act', text: '<<EDIT\u200b_GRAPH>>{"wave":{"freq":3}}<<END_EDIT>>',
    html: '&lt;&lt;EDIT\u200b_GRAPH&gt;&gt;{"wave":{"freq":3}}&lt;&lt;END_EDIT&gt;&gt;' },
  { name: 'lower-case tag does not act', text: '<<edit_graph>>{"wave":{"freq":3}}<<end_edit>>',
    html: '&lt;&lt;edit_graph&gt;&gt;{"wave":{"freq":3}}&lt;&lt;end_edit&gt;&gt;' },

  // Side-thread scope: the state-changing tags are deferred, the display ones still work.
  { name: 'thread defers edit, suggest and commit',
    scope: 'thread',
    text: `A.\n${edit(WAVE3)}\n<<SUGGEST type="lesson" title="T">>c<<END_SUGGEST>>\n${commit('{"message":"m","paths":["a"]}')}\n<<REINFORCE>>r<<END_REINFORCE>>`,
    obs: ['thread-tag-deferred', 'thread-tag-deferred', 'thread-tag-deferred'], reinforced: ['r'], html: 'A.' },

  // Desmos payload rules.
  { name: 'desmos autoplay is stripped',
    text: desmos('{"expressions":{"list":[{"id":"a","latex":"a=1","isPlaying":true}]}}'),
    html: `<div class="chat-desmos-block" data-desmos-state="${Buffer.from('{"expressions":{"list":[{"id":"a","latex":"a=1"}]}}').toString('base64')}"></div>` },
  { name: 'a fourth desmos block is refused', text: [1, 2, 3, 4].map(() => desmos('{}')).join('\n'),
    obs: ['desmos-lint'],
    html: '<div class="chat-desmos-block" data-desmos-state="e30="></div><div class="chat-desmos-block" data-desmos-state="e30="></div><div class="chat-desmos-block" data-desmos-state="e30="></div>' },

  // HTML, handlers and URLs in what the markdown keeps verbatim.
  { name: 'script in prose renders as text', text: 'Hello <script>x()</script> world',
    html: 'Hello &lt;script&gt;x()&lt;/script&gt; world' },
  { name: 'img handler in prose is dropped', text: 'See <img src="/p.png" onerror="x()">',
    html: 'See <div class="chat-media-block"><img src="/p.png"></div>' },
  { name: 'SOURCES javascript: link loses its href', text: '<<SOURCES>>\n- [c](javascript:x())\n<<END_SOURCES>>',
    html: '<details class="chat-sources"><summary>Sources</summary><ul><li><a href="#" target="_blank" rel="noopener">c</a>)</li></ul></details>' },
  { name: 'SOURCES javascript: link split by a tab loses its href', text: '<<SOURCES>>\n- [c](java\tscript:x())\n<<END_SOURCES>>',
    html: '<details class="chat-sources"><summary>Sources</summary><ul><li><a target="_blank" rel="noopener">c</a>)</li></ul></details>' },
  { name: 'SOURCES javascript: link behind a zero-width char loses its href', text: '<<SOURCES>>\n- [c](\u200bjavascript:x())\n<<END_SOURCES>>',
    html: '<details class="chat-sources"><summary>Sources</summary><ul><li><a target="_blank" rel="noopener">c</a>)</li></ul></details>' },
  { name: 'SOURCES https link keeps href and gains noopener', text: '<<SOURCES>>\n- [G](https://example.com/g)\n<<END_SOURCES>>',
    html: '<details class="chat-sources"><summary>Sources</summary><ul><li><a href="https://example.com/g" target="_blank" rel="noopener">G</a></li></ul></details>' },
  { name: 'markdown image with javascript: src loses its src', text: '![a](javascript:x())',
    html: '<div class="chat-media-block"><img src="#" alt="a" style="max-width: 100%"></div>)' },
  { name: 'markdown image alt cannot add a handler', text: '![a" onerror="x()](/p.png)',
    html: '<div class="chat-media-block"><img src="/p.png" alt="a" style="max-width: 100%"></div>' },
  { name: 'DEMO title carrying markup keeps no handler',
    text: '<<DEMO title="<img src=/p.png onerror=x()>">><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg><<END_DEMO>>',
    html: '<div class="chat-demo-block"><div class="chat-demo-title"><img src="/p.png"></div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"></rect></svg></div>' },
  { name: 'DEMO svg handlers and javascript: link are dropped',
    text: svgDemo('<a href="javascript:x()"><rect width="5" height="5" onclick="x()"/></a>', ' onload="x()"'),
    html: '<div class="chat-demo-block"><div class="chat-demo-title">d</div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="#"><rect width="5" height="5"></rect></a></svg></div>' },
  { name: 'svg animation cannot retarget a link',
    text: '<svg viewBox="0 0 10 10"><a><set attributeName="href" to="javascript:x()"/><text y="5">c</text></a></svg>',
    html: '<div class="chat-media-block"><svg viewBox="0 0 10 10"><a><text y="5">c</text></a></svg></div>' },
  { name: 'carrier div: iframe, style and form are dropped',
    text: carrier('<iframe src="https://e.example/"></iframe><style>body{display:none}</style><form action="https://e.example/"><button>Go</button></form>ok'),
    html: '<div class="chat-demo-block"><div class="chat-demo-title">t</div>ok</div>' },
  { name: 'carrier div: position:fixed overlay is dropped',
    text: carrier('<span style="position:fixed;inset:0;color:red">hi</span>'),
    html: '<div class="chat-demo-block"><div class="chat-demo-title">t</div><span style="inset: 0; color: red">hi</span></div>' },
  // Layer 1 runs on the whole HTML string, so it also cuts handler TEXT out of an escaped code
  // sample. That costs a few characters of a code example; it never lets markup through.
  { name: 'markup inside a code fence renders as text', text: '```html\n<img src="/p.png" onerror="x()">\n```',
    html: '<pre class="chat-pre"><code class="chat-code-block">&lt;img src="/p.png"&gt;\n</code></pre>' },
];

exports.stream = [
  { name: 'half-arrived edit is hidden', text: 'Hi <<EDIT_GRAPH>>{"wa', out: 'Hi ' },
  { name: 'half-arrived closer fragment is hidden', text: 'Hi <<END_', out: 'Hi ' },
  { name: 'closed tag is left for processResponse', text: `Hi ${edit(WAVE3)} there`, out: `Hi ${edit(WAVE3)} there` },
  { name: 'unclosed commit after closed edit is cut at the commit', text: `A ${edit(WAVE3)} B <<COMMIT_SUGGEST>>{"m`, out: `A ${edit(WAVE3)} B ` },
];

exports.layer1 = [
  { name: 'script block', text: 'a<script>x()</script>b', out: 'ab' },
  { name: 'unclosed script tag', text: 'a<script src="//e.example/x.js">b', out: 'ab' },
  { name: 'iframe block', text: 'a<iframe src="//e.example/"></iframe>b', out: 'ab' },
  { name: 'double-quoted handler', text: '<img src="p.png" onerror="x()">', out: '<img src="p.png">' },
  { name: 'single-quoted handler', text: "<img src='p.png' onload='x()'>", out: "<img src='p.png'>" },
  { name: 'bare handler', text: '<img src=p.png onerror=x()>', out: '<img src=p.png>' },
  { name: 'quoted javascript: href', text: '<a href="javascript:x()">c</a>', out: '<a href="#">c</a>' },
  { name: 'bare javascript: href', text: '<a href=javascript:x()>c</a>', out: '<a href=#>c</a>' },
  { name: 'quoted data:text/html src', text: '<img src="data:text/html,x">', out: '<img src="#">' },
];

exports.layer2 = [
  { name: 'handler attribute', text: '<img src="p.png" onerror="x()">', html: '<img src="p.png">', dropped: ['event handler'] },
  { name: 'javascript: href', text: '<a href="javascript:x()">c</a>', html: '<a>c</a>', dropped: ['url scheme (other)'] },
  { name: 'javascript: href split by an encoded tab', text: '<a href="java&#9;script:x()">c</a>', html: '<a>c</a>', dropped: ['url scheme (other)'] },
  { name: 'data:text/html src', text: '<img src="data:text/html,x">', html: '<img>', dropped: ['url scheme (data-other)'] },
  { name: 'attribute outside the allowlist', text: '<img src="p.png" srcset="q.png 2x">', html: '<img src="p.png">', dropped: ['not in allowlist'] },
  { name: 'element outside the allowlist', text: '<form action="https://e.example/"><button>Go</button></form><style>p{}</style>ok',
    html: 'ok', dropped: ['not in allowlist'] },
  { name: 'external url() in an svg paint attribute', text: '<svg><rect fill="url(https://e.example/x#p)"></rect></svg>',
    html: '<svg><rect></rect></svg>', dropped: ['unsafe value'] },
  { name: 'escaped url() in inline style', text: '<span style="background:\\75rl(https://e.example/x)">s</span>',
    html: '<span>s</span>', dropped: ['unsafe inline style'] },
  { name: 'position:fixed in inline style', text: '<span style="position:fixed;color:red">s</span>',
    html: '<span style="color: red">s</span>', dropped: ['position:fixed'] },
  { name: 'external svg use href', text: '<svg><use href="https://e.example/x.svg#y"></use></svg>',
    html: '<svg><use></use></svg>', dropped: ['url scheme (web)'] },
  { name: 'new-tab link gains noopener', text: '<a href="https://example.com" target="_blank">c</a>',
    html: '<a href="https://example.com" target="_blank" rel="noopener">c</a>', dropped: [] },
  { name: 'animation retargeting href', text: '<svg><a><set attributeName="href" to="#x"></set></a></svg>',
    html: '<svg><a></a></svg>', dropped: ['animates href'] },
];
