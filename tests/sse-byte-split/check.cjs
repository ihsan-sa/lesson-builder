#!/usr/bin/env node
/**
 * SSE byte-split evidence.
 *
 * Proof that the reader between the CLI's stdout and the tutor's SSE stream survives a chunk
 * boundary falling anywhere: mid JSON object, and mid UTF-8 character. The reader is
 * `createNdjsonReader` in `references/bootstrap/_lesson-core/server/ndjson.js`; its one caller is
 * `runClaudeStreaming` in `server/proxy.js`.
 *
 * Node only. No npm install, no network, no browser, no proxy boot: the reader is a module, and
 * each case drives it directly with the split it is about. Runs in about a second. Exit code 0
 * only when every check passes.
 *
 * What the cases assert is in README.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SKILL = path.resolve(__dirname, '..', '..');
const CORE = path.join(SKILL, 'references', 'bootstrap', '_lesson-core');
const NDJSON = path.join(CORE, 'server', 'ndjson.js');
const PROXY = path.join(CORE, 'server', 'proxy.js');

let pass = 0;
const failures = [];
function check(what, ok, detail) {
  if (ok) { pass++; return; }
  failures.push(detail ? `${what}\n      ${detail}` : what);
}
function eq(what, got, want) {
  check(what, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function heading(n, text) { console.log(`\n${n}  ${text}`); }

// Feed `bytes` to a fresh reader in chunks cut at `cuts`, and return the events it emitted.
function readWithCuts(createNdjsonReader, bytes, cuts) {
  const events = [];
  const reader = createNdjsonReader((e) => events.push(e));
  let at = 0;
  for (const cut of [...cuts, bytes.length]) {
    if (cut <= at) continue;
    reader.push(bytes.subarray(at, cut));
    at = cut;
  }
  if (at < bytes.length) reader.push(bytes.subarray(at));
  reader.end();
  return events;
}

// A stream the CLI really writes: an init object, three text deltas, a result. The text carries
// one character of each UTF-8 width, because a 2-, 3- and 4-byte rune each split differently.
const TEXT_1 = 'The derivative — d/dx — of x²';          // 3-byte em-dash, 2-byte superscript
const TEXT_2 = 'is 2x, or ≈ 2·x when you prefer 𝄞';       // 3-byte ≈ and ·, 4-byte 𝄞
const TEXT_3 = 'naïve café — π ≠ 3, and 🎯 is the point'; // 2-byte ï/é, 4-byte emoji
const STREAM_EVENTS = [
  { type: 'system', subtype: 'init', session_id: 'abc-123' },
  { type: 'assistant', message: { content: [{ type: 'text', text: TEXT_1 }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: TEXT_2 }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: TEXT_3 }] } },
  { type: 'result', result: `${TEXT_1} ${TEXT_2} ${TEXT_3}`, total_cost_usd: 0.004 },
];
// No trailing newline: the CLI's last line has none, so the result object only ever reaches the
// proxy through end().
const STREAM_TEXT = STREAM_EVENTS.map((e) => JSON.stringify(e)).join('\n');
const STREAM_BYTES = Buffer.from(STREAM_TEXT, 'utf8');

(async function main() {
  console.log(`sse byte-split fixture (${NDJSON})`);
  const { createNdjsonReader } = await import(pathToFileURL(NDJSON).href);

  // ---------------------------------------------------------------- 1
  heading(1, 'one chunk per stream, and one chunk per line');
  {
    const whole = readWithCuts(createNdjsonReader, STREAM_BYTES, []);
    eq('a single chunk yields every event', whole.length, STREAM_EVENTS.length);
    check('…byte-identical to what was written',
      JSON.stringify(whole) === JSON.stringify(STREAM_EVENTS),
      JSON.stringify(whole));

    const lineCuts = [];
    for (let i = 0; i < STREAM_BYTES.length; i++) if (STREAM_BYTES[i] === 0x0a) lineCuts.push(i + 1);
    const byLine = readWithCuts(createNdjsonReader, STREAM_BYTES, lineCuts);
    check('one chunk per line yields the same events',
      JSON.stringify(byLine) === JSON.stringify(STREAM_EVENTS));
    eq('the last line, which has no newline, is emitted once', byLine.filter((e) => e.type === 'result').length, 1);
  }

  // ---------------------------------------------------------------- 2
  heading(2, 'a cut at every single byte offset in the stream');
  {
    let wrong = null;
    let corrupt = null;
    for (let cut = 1; cut < STREAM_BYTES.length; cut++) {
      const got = readWithCuts(createNdjsonReader, STREAM_BYTES, [cut]);
      if (JSON.stringify(got) !== JSON.stringify(STREAM_EVENTS)) { wrong = wrong ?? cut; }
      if (JSON.stringify(got).includes('\uFFFD')) { corrupt = corrupt ?? cut; }
    }
    check(`every one of the ${STREAM_BYTES.length - 1} cut points yields the same events`,
      wrong === null, wrong === null ? '' : `first wrong at byte ${wrong}`);
    check('…and none of them produces a replacement character',
      corrupt === null, corrupt === null ? '' : `first corrupt at byte ${corrupt}`);
  }

  // ---------------------------------------------------------------- 2b
  heading('2b', 'the same stream cut into every byte, one at a time');
  {
    const everyByte = [];
    for (let i = 1; i < STREAM_BYTES.length; i++) everyByte.push(i);
    const got = readWithCuts(createNdjsonReader, STREAM_BYTES, everyByte);
    check('a one-byte-at-a-time stream yields exactly the events that were written',
      JSON.stringify(got) === JSON.stringify(STREAM_EVENTS));
    const texts = got.filter((e) => e.type === 'assistant').map((e) => e.message.content[0].text);
    check('…with every multi-byte character intact',
      JSON.stringify(texts) === JSON.stringify([TEXT_1, TEXT_2, TEXT_3]),
      JSON.stringify(texts));
  }

  // ---------------------------------------------------------------- 2c
  heading('2c', 'the check is not vacuous: the decode this replaced does corrupt it');
  {
    // What `buffer += chunk.toString()` did, chunk by chunk. If this ever stops corrupting the
    // stream, cases 2 and 2b are asserting nothing and must be re-thought rather than trusted.
    const naive = (bytes, cuts) => {
      let buffer = '';
      let at = 0;
      const out = [];
      for (const cut of [...cuts, bytes.length]) {
        if (cut <= at) continue;
        buffer += bytes.subarray(at, cut).toString();
        at = cut;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const l of lines) { try { out.push(JSON.parse(l.trim())); } catch (_) {} }
      }
      if (buffer.trim()) { try { out.push(JSON.parse(buffer.trim())); } catch (_) {} }
      return out;
    };
    // The first byte of the em-dash in TEXT_1: cutting inside it is what the old reader lost.
    const dash = STREAM_BYTES.indexOf(Buffer.from('—', 'utf8'));
    check('the fixture stream really does contain a 3-byte character', dash > 0, `indexOf = ${dash}`);
    const naiveGot = naive(STREAM_BYTES, [dash + 1]);
    check('the old per-chunk decode mangles a cut inside that character',
      JSON.stringify(naiveGot).includes('\uFFFD'),
      'the naive decode came through clean — this fixture would prove nothing');
    const readerGot = readWithCuts(createNdjsonReader, STREAM_BYTES, [dash + 1]);
    check('…and the reader under test does not',
      JSON.stringify(readerGot) === JSON.stringify(STREAM_EVENTS));
  }

  // ---------------------------------------------------------------- 3
  heading(3, 'a character split across three chunks, and one that never completes');
  {
    const musical = Buffer.from('{"t":"𝄞"}\n', 'utf8'); // 4 bytes for the one character
    const start = musical.indexOf(0xf0);
    check('the fixture line really does contain a 4-byte character', start > 0, `indexOf = ${start}`);
    const got = readWithCuts(createNdjsonReader, musical, [start + 1, start + 2, start + 3]);
    eq('a 4-byte character delivered one byte per chunk arrives whole', got.length, 1);
    eq('…as the character that was written', got[0] && got[0].t, '𝄞');

    // A turn killed mid-character: the last bytes never arrive. Nothing may throw, and a line
    // that cannot be parsed is dropped the way an MCP diagnostic is.
    const events = [];
    const reader = createNdjsonReader((e) => events.push(e));
    let threw = null;
    try {
      reader.push(Buffer.from('{"a":1}\n', 'utf8'));
      reader.push(musical.subarray(0, start + 2)); // half a character, then the stream ends
      reader.end();
    } catch (e) { threw = e; }
    check('a stream that ends mid-character does not throw', threw === null, threw && threw.message);
    eq('…and the complete line before it is still delivered', events.length, 1);
    eq('…as itself', events[0] && events[0].a, 1);
  }

  // ---------------------------------------------------------------- 4
  heading(4, 'the noise the CLI shares stdout with');
  {
    const noise = 'Client.listTools() called but server does not advertise tools capability';
    const bytes = Buffer.from(
      `${noise}\n${JSON.stringify({ type: 'system', session_id: 's1' })}\n` +
      `${noise}\n${JSON.stringify({ type: 'result', result: 'done' })}`, 'utf8');
    for (const cuts of [[], [3], [noise.length + 1], [bytes.length - 2]]) {
      const got = readWithCuts(createNdjsonReader, bytes, cuts);
      check(`a bare diagnostic line is dropped, not thrown (cut ${JSON.stringify(cuts)})`,
        got.length === 2 && got[0].type === 'system' && got[1].type === 'result',
        JSON.stringify(got));
    }
    // A blank line is not an event either — the CLI emits them between objects.
    const blanks = readWithCuts(createNdjsonReader, Buffer.from('\n\n{"a":1}\n\n\n', 'utf8'), []);
    eq('blank lines emit nothing', blanks.length, 1);
  }

  // ---------------------------------------------------------------- 5
  heading(5, 'end() is final: nothing is delivered twice');
  {
    const events = [];
    const reader = createNdjsonReader((e) => events.push(e));
    reader.push(Buffer.from('{"a":1}\n{"b":2}', 'utf8'));
    eq('the complete line arrives on push', events.length, 1);
    reader.end();
    eq('the incomplete tail arrives on end', events.length, 2);
    reader.end();
    eq('a second end delivers nothing again', events.length, 2);
    check('…and the two events are the two that were written',
      JSON.stringify(events) === JSON.stringify([{ a: 1 }, { b: 2 }]), JSON.stringify(events));
  }

  // ---------------------------------------------------------------- 6
  heading(6, 'what the proxy writes into the SSE stream');
  {
    // The proxy frames an event as `event: <name>\ndata: <json>\n\n`. Model text carries
    // newlines, so what keeps a reply from being read as several SSE frames is that the payload
    // is JSON, never the raw text. Asserted here because the reader above is what feeds it.
    const text = 'line one\n\nevent: done\ndata: {"text":"injected"}\n\nline two';
    const frame = `event: text\ndata: ${JSON.stringify({ text })}\n\n`;
    eq('a reply that contains a blank line is one SSE frame, not three',
      frame.split('\n\n').filter(Boolean).length, 1);
    check('…and the text a reader parses back out is the text that went in',
      JSON.parse(frame.slice(frame.indexOf('data: ') + 6).trim()).text === text);
    check('a reply that spells out an SSE frame does not become one',
      !frame.slice(0, frame.indexOf('data: ')).includes('done'));
  }

  // ---------------------------------------------------------------- 7
  heading(7, 'the reader has the caller it was extracted for');
  {
    // A source check, the way tests/thread-actors case 8 reads the client it cannot drive: this
    // fixture proves the module, and this is what keeps proxy.js from quietly going back to
    // decoding each chunk on its own.
    const proxy = fs.readFileSync(PROXY, 'utf8');
    check('proxy.js imports the reader', /import\s*\{\s*createNdjsonReader\s*\}\s*from\s*"\.\/ndjson\.js"/.test(proxy));
    check('…and runClaudeStreaming drives it', /reader\s*=\s*createNdjsonReader\(onEvent\)/.test(proxy));
    check('…on both halves: every chunk, and the end of the stream',
      /reader\.push\(/.test(proxy) && /reader\.end\(\)/.test(proxy));
    check('no per-chunk decode is left on the streaming path',
      !/buffer\s*\+=\s*d\.toString\(\)/.test(proxy),
      'proxy.js still decodes a stdout chunk on its own');
    const ndjson = fs.readFileSync(NDJSON, 'utf8');
    check('the reader decodes with StringDecoder, which is what carries a split character',
      /from\s*"string_decoder"/.test(ndjson) && /decoder\.write\(/.test(ndjson) && /decoder\.end\(\)/.test(ndjson));
  }

  console.log('');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass}/${pass + failures.length} checks passed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
