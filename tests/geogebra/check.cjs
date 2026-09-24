#!/usr/bin/env node
/**
 * GeoGebra embed evidence: the sample section in lesson/geogebra_demo.jsx,
 * built and served by run.sh, driven in Chrome. Every case opens its own page
 * and asserts only on what that page did. What each case holds is in README.md.
 *
 * Env: LESSON_URL (required), LESSON_DIR (a lesson with playwright installed),
 *      GEOGEBRA_BROWSER (optional Chrome binary).
 * Exit code 0 only when every case passes.
 */
'use strict';
const path = require('path');

function resolveDep(spec) {
  for (const base of [__dirname, process.cwd(), process.env.LESSON_DIR].filter(Boolean)) {
    try { return require.resolve(spec, { paths: [base] }); } catch (_) {}
  }
  throw new Error(`cannot resolve ${spec}; npm install in tests/geogebra or set LESSON_DIR`);
}
const { chromium } = require(resolveDep('playwright'));

const URL = process.env.LESSON_URL;
if (!URL) { console.error('LESSON_URL is required'); process.exit(2); }
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
// The applet codebase is several MB from geogebra.org; 8 s here on a warm
// line, so a minute is room for a cold one without hiding a hang.
const READY_MS = 60000;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

async function open(browser, viewport, query = '', setup) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => msgs.push(`pageerror: ${e.message}`));
  if (setup) await setup(page);
  await page.goto(URL + query);
  return { ctx, page, msgs };
}

// Serialised into the page, so it takes everything it reads as its argument.
const allSettled = ({ want, n }) => {
  const roots = [...document.querySelectorAll('[data-ggb]')];
  return roots.length >= n && roots.every(r => r.getAttribute('data-ggb') === want);
};

async function waitAll(page, want, n, timeout) {
  try { await page.waitForFunction(allSettled, { want, n }, { timeout }); return true; } catch (_) { return false; }
}

const cspViolations = msgs => msgs.filter(m => /Content Security Policy|Refused to/i.test(m));

// Each applet's drawn width against its column, and the page's own overflow.
const geometry = page => page.evaluate(() => ({
  pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  figures: [...document.querySelectorAll('[data-ggb]')].map(r => {
    const host = r.querySelector('.gg-host');
    const applet = host && host.firstElementChild;
    return {
      mid: r.getAttribute('data-mid'),
      root: Math.round(r.getBoundingClientRect().width),
      host: host ? Math.round(host.getBoundingClientRect().width) : 0,
      applet: applet ? Math.round(applet.getBoundingClientRect().width) : 0,
    };
  }),
}));

async function phoneCase(browser) {
  const { ctx, page, msgs } = await open(browser, PHONE);
  const up = await waitAll(page, 'ready', 2, READY_MS);
  ok('phone: both figures reach ready', up, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-ggb]')].map(r => r.getAttribute('data-ggb')))));
  if (!up) console.log(msgs.slice(0, 20).join('\n'));
  ok('phone: no CSP violation loading GeoGebra', cspViolations(msgs).length === 0, cspViolations(msgs).join(' | '));
  const errs = msgs.filter(m => /^pageerror/.test(m));
  ok('phone: no uncaught page error', errs.length === 0, errs.join(' | '));
  const notes = await page.evaluate(() => [...document.querySelectorAll('.gg-note')].map(n => n.innerText));
  ok('phone: GeoGebra accepted every command of the sample', notes.length === 0, notes.join(' | '));
  const g = await geometry(page);
  ok('phone: page does not scroll sideways', g.pageOverflow <= 1, `overflow ${g.pageOverflow}px`);
  for (const f of g.figures) {
    ok(`phone: ${f.mid} applet drawn inside its column`, f.applet > 200 && f.applet <= f.host + 1, JSON.stringify(f));
  }

  // The construction teaches only if it holds while P moves: alpha stays put
  // and stays half of beta. Read back through the API onReady handed over.
  const r = await page.evaluate(() => {
    const api = window.__ggb && window.__ggb['inscribed-angle'];
    if (!api) return null;
    const a0 = api.getValue('angP'), b = api.getValue('angO');
    api.setCoords('P', -3, 0.5);
    const a1 = api.getValue('angP');
    const v = JSON.parse(api.getViewProperties(1));
    return { a0, a1, b, px: api.getXcoord('P'), py: api.getYcoord('P'), ratio: v.invXscale / v.invYscale };
  });
  ok('phone: onReady handed the inscribed-angle API over', !!r);
  if (r) {
    ok('phone: P moved on the circle', Math.abs(Math.hypot(r.px, r.py) - 3) < 1e-6 && r.px < -2 && r.py > 0, JSON.stringify(r));
    ok('phone: angle APB is unchanged after moving P', Math.abs(r.a0 - r.a1) < 1e-9, JSON.stringify(r));
    ok('phone: the circle is drawn round, not as an ellipse', Math.abs(r.ratio - 1) < 1e-6, JSON.stringify(r));
    ok('phone: angle APB is half the central angle', Math.abs(r.a0 - r.b / 2) < 1e-9, JSON.stringify(r));
  }
  const s = await page.evaluate(() => {
    const api = window.__ggb && window.__ggb.saddle;
    return api ? { type: api.getObjectType('f'), z: api.getValue('f(2, 0)') } : null;
  });
  ok('phone: the 3D figure holds the saddle surface', s && s.z === 1, JSON.stringify(s));
  await page.screenshot({ path: path.join(process.env.TMPDIR || '/tmp', 'geogebra-phone.png'), fullPage: true });
  await ctx.close();
}

async function desktopResizeCase(browser) {
  const { ctx, page } = await open(browser, DESKTOP);
  const up = await waitAll(page, 'ready', 2, READY_MS);
  ok('desktop: both figures reach ready', up);
  const wide = await geometry(page);
  await page.setViewportSize({ width: 700, height: 900 });
  // The ResizeObserver debounces 100 ms before telling GeoGebra.
  await page.waitForTimeout(1500);
  const narrow = await geometry(page);
  for (let i = 0; i < narrow.figures.length; i++) {
    const w = wide.figures[i], n = narrow.figures[i];
    ok(`desktop: ${n.mid} applet follows its column when the window narrows`,
      n.applet < w.applet && Math.abs(n.applet - n.host) <= 2, `wide ${JSON.stringify(w)} narrow ${JSON.stringify(n)}`);
  }
  await ctx.close();
}

// The negative control for the loader: geogebra.org unreachable. The kept case
// is the fallback box; the suppressed one is "Loading figure..." forever.
async function blockedCase(browser) {
  const { ctx, page, msgs } = await open(browser, PHONE, '', p => p.route(/geogebra\.org/, r => r.abort()));
  const down = await waitAll(page, 'failed', 2, 15000);
  ok('blocked: both figures settle as failed within the bound', down);
  const text = await page.evaluate(() => document.body.innerText);
  ok('blocked: the fallback says geogebra.org could not be reached', /GeoGebra figure unavailable/.test(text));
  ok('blocked: no figure is left on "Loading figure..."', !/Loading figure/.test(text));
  ok('blocked: one console error names the failure', msgs.filter(m => /\[useGeoGebra\]/.test(m)).length === 1, msgs.join(' | '));
  await ctx.close();
}

// A command GeoGebra rejects is named under its figure, and the commands after
// it still run.
async function badCommandCase(browser) {
  const { ctx, page, msgs } = await open(browser, PHONE, '?bad=1');
  const up = await waitAll(page, 'ready', 3, READY_MS);
  ok('bad command: all three figures still reach ready', up);
  const r = await page.evaluate(() => {
    const root = document.querySelector('[data-mid="bad-command"]');
    const api = window.__ggb && window.__ggb['bad-command'];
    return { note: root && root.innerText, h: api ? api.exists('h') : null, g: api ? api.exists('g') : null,
      goodNotes: [...document.querySelectorAll('[data-mid="inscribed-angle"] .gg-note, [data-mid="saddle"] .gg-note')].length };
  });
  ok('bad command: the rejected command is named under the figure', /GeoGebra rejected: g\(x\) = sin\(x/.test(r.note || ''), JSON.stringify(r));
  ok('bad command: the command after it still ran', r.h === true && r.g === false, JSON.stringify(r));
  ok('bad command: the good figures carry no rejection note', r.goodNotes === 0, JSON.stringify(r));
  ok('bad command: GeoGebra showed no modal over the page', await page.evaluate(() => !/Please check your input/.test(document.body.innerText)));
  ok('bad command: the rejection is logged', msgs.some(m => /GeoGebraGraph bad-command\] GeoGebra rejected/.test(m)), msgs.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch(process.env.GEOGEBRA_BROWSER ? { executablePath: process.env.GEOGEBRA_BROWSER } : {});
  try {
    await phoneCase(browser);
    await desktopResizeCase(browser);
    await blockedCase(browser);
    await badCommandCase(browser);
  } finally {
    await browser.close();
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); console.log(`${passed} passed, ${failed + 1} failed`); process.exit(1); });
