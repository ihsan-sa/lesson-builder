#!/usr/bin/env node
/**
 * lesson-ast — the lesson file read as JavaScript, never as text.
 *
 * The existing-media inventory, the splice of new or replaced media, and the decision that a
 * component or helper is unused all come from a Babel parse of `src/<slug>.jsx`. Nothing here
 * greps the source, counts braces, or trusts a filename. A lesson the parser cannot parse fails
 * with the parse error and its line and column (exit 2); there is no regex fallback.
 *
 * Usage:
 *   lesson-ast.cjs inventory    --lesson <dir> [--file <jsx>]
 *   lesson-ast.cjs reachability --file <jsx> [--removing <Name>[,<Name>...]]
 *   lesson-ast.cjs digest       --file <jsx> --name <X> [--name <Y> ...]
 *   lesson-ast.cjs replace      --file <jsx> <target> --with <file> [--write]
 *   lesson-ast.cjs remove       --file <jsx> <target> [<target>...] [--write]
 *
 * A <target> names one node by what it is, not by where it is:
 *   --component <Name>     a top-level `function <Name>(...)` or `const <Name> = (...) =>`
 *   --call-site <Name>     every `<Name .../>` element, with its `<LiveGraph>` wrapper when the
 *                          wrapper holds nothing else
 *   --constant <NAME>      a top-level `const <NAME> = ...` declaration
 *   --demo "<title>"       the `<InteractiveDemo title="<title>">...</InteractiveDemo>` element
 *   --params-key <key>     one entry of `DEFAULT_GRAPH_PARAMS`
 *   --schema-key <key>     one entry of `GRAPH_SCHEMA`
 * `remove` takes several and applies them back to front in one pass; `replace` takes one — so a
 * `--call-site` that matches more than one element is a removal, never a replacement.
 * Without `--write` the new file goes to stdout and nothing on disk changes. With `--write` the
 * file is replaced through a `.part` name and the bytes are read back, and a receipt goes to
 * stdout: the ranges touched, the bytes each target removed and inserted, and `declarations` —
 * how many top-level declarations no target named were re-parsed out of the result and found
 * byte-identical, plus any that were `changed`, `removed` or `added`. That check does not go
 * through the splice's own offset arithmetic: it compares declaration source text by name across
 * two parses, so a range that ran into its neighbour shows up as that neighbour changed or gone.
 * A changed or removed declaration no target named exits 4 and writes nothing; an added one is
 * reported, because a scratch file may legitimately bring a helper with it. That receipt is what
 * makes a whole-file line-count delta check unnecessary — the splice knows what it replaced, and
 * says what it left alone.
 *
 * Graph or helper: a graph component is a top-level function whose first parameter is an object
 * pattern carrying `params` — the `({ params, mid = "" })` shape every graph in the template has.
 * Capitalisation decides nothing, so a lesson-local `HWQuestion` is a helper, not a graph.
 *
 * Manim pairing is re-verified, never assumed from the filename stem: a `.py` is the source of a
 * referenced video when the stems match, when a `class <Name>(...Scene...)` in it normalises to
 * the video's stem (manim names its output after the Scene, not the script), or when the video's
 * filename appears in the source text. Only a `.py` with no such evidence is an orphan.
 *
 * `digest` hashes each named thing's own source bytes, not the file's: a top-level declaration
 * (its `export` wrapper included) or an `<InteractiveDemo title="X">` block. That is what lets a
 * Phase 4 verdict attest to one graph inside a shared lesson file, so refining one graph does not
 * invalidate the other five (`references/run-record.md` § Attestations).
 *
 * @babel/parser is resolved from the lesson's own `node_modules` — it is already a devDependency
 * of the lesson template — then from this skill and the ambient environment.
 *
 * Schema and field-by-field derivation: references/phase-1-content.md § Existing-media inventory.
 * Splice algorithm: references/phase-3-execution.md § Step 4.
 *
 * Exit codes:
 *   0  ok
 *   1  usage or I/O error
 *   2  the lesson does not parse — the message carries the parse error, line and column
 *   3  a target matched nothing; nothing was spliced and the file is untouched. `digest`: a
 *      `--name` is neither a top-level declaration nor a demo title in that file — its JSON still
 *      goes to stdout, with those names under `missing` and the rest hashed
 *   4  the splice is refused: the result does not parse, or it would have changed or removed a
 *      top-level declaration no target named. Nothing was written either way.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function die(msg, code) {
  process.stderr.write(`lesson-ast: ${msg}\n`);
  process.exit(code === undefined ? 1 : code);
}

// ---------- argv ----------

// A repeated flag collects into an array, so `remove --params-key a --params-key b` is one call.
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') { flags.write = true; continue; }
    if (!a.startsWith('--')) die(`unexpected argument ${a}`);
    const key = a.slice(2);
    const val = argv[++i];
    if (val === undefined) die(`flag --${key} needs a value`);
    if (flags[key] === undefined) flags[key] = val;
    else if (Array.isArray(flags[key])) flags[key].push(val);
    else flags[key] = [flags[key], val];
  }
  return flags;
}

const list = (flags, key) =>
  flags[key] === undefined ? [] : Array.isArray(flags[key]) ? flags[key] : [flags[key]];

// ---------- parse ----------

function loadParser(lessonRoot) {
  const paths = [];
  if (lessonRoot) {
    paths.push(lessonRoot);
    // The workspace's shared `_lesson-core/`, a sibling of the course rather than an ancestor of
    // the lesson, so require.resolve would not find it walking up from the lesson root.
    paths.push(path.resolve(lessonRoot, '..', '..', '..', '_lesson-core'));
  }
  paths.push(__dirname, process.cwd());
  try {
    return require(require.resolve('@babel/parser', { paths }));
  } catch (e) {
    /* fall through to the ambient resolution */
  }
  try {
    return require('@babel/parser');
  } catch (e) {
    return die(
      '@babel/parser not found. It is a devDependency of the lesson template: run `npm install` ' +
        'in the lesson root, or point at a lesson that has one.',
    );
  }
}

function parse(parser, code, file) {
  try {
    return parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    const at = e.loc ? `${file}:${e.loc.line}:${e.loc.column + 1}` : file;
    die(`${at}: ${e.message}`, 2);
  }
}

/** Every node in the tree, parents before children. Comments are not nodes and are skipped. */
function walk(node, visit, parent) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, node);
    } else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}

const lineRange = (node) => [node.loc.start.line, node.loc.end.line];

// ---------- the lesson's top-level declarations ----------

const isFn = (n) =>
  n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' ||
        n.type === 'FunctionDeclaration');

/** The `({ params, mid = "" })` shape every graph component in the template has. */
function isGraphSignature(fn) {
  if (!isFn(fn) || !fn.params.length) return false;
  const first = fn.params[0];
  if (!first || first.type !== 'ObjectPattern') return false;
  return first.properties.some(
    (p) => p.type === 'ObjectProperty' && p.key && p.key.type === 'Identifier' &&
           p.key.name === 'params',
  );
}

/**
 * One row per top-level binding: `{ name, node, decl, kind, exported, fn }`, where `node` is the
 * binding's own initialiser or function and `decl` is the statement a splice would cut out
 * (the `export` wrapper included, so removing an exported binding removes its export).
 */
function topLevel(ast) {
  const rows = [];
  const roots = [];
  const exportedNames = new Set();
  const add = (name, node, decl, kind, exported) =>
    rows.push({ name, node, decl, kind, exported, fn: isFn(node) ? node : null });

  for (const stmt of ast.program.body) {
    let inner = stmt;
    let exported = false;
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
      inner = stmt.declaration;
      exported = true;
    } else if (stmt.type === 'ExportDefaultDeclaration') {
      // The default export is a root: whatever it names is reachable.
      roots.push(stmt);
      if (stmt.declaration && stmt.declaration.type === 'Identifier')
        exportedNames.add(stmt.declaration.name);
      if (stmt.declaration && stmt.declaration.type === 'FunctionDeclaration' &&
          stmt.declaration.id) {
        add(stmt.declaration.id.name, stmt.declaration, stmt, 'function', true);
      }
      continue;
    } else if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') {
      roots.push(stmt);
      for (const s of stmt.specifiers || []) if (s.local) exportedNames.add(s.local.name);
      continue;
    }

    if (inner.type === 'ImportDeclaration') {
      for (const s of inner.specifiers) add(s.local.name, s, stmt, 'import', false);
    } else if (inner.type === 'FunctionDeclaration' && inner.id) {
      add(inner.id.name, inner, stmt, 'function', exported);
    } else if (inner.type === 'VariableDeclaration') {
      for (const d of inner.declarations) {
        if (d.id && d.id.type === 'Identifier') add(d.id.name, d.init || d, stmt, 'const', exported);
        else roots.push(d); // a destructuring binding at module scope: treat its uses as roots
      }
    } else {
      roots.push(stmt); // a bare statement at module scope runs, so what it names is reachable
    }
  }
  // `export default LessonApp;` and `export { X };` name a binding declared further up: it is
  // exported, so it is neither a lesson-local helper nor unreachable.
  for (const r of rows) if (exportedNames.has(r.name)) r.exported = true;
  return { rows, roots };
}

/**
 * Every top-level name referenced inside `node`, in reference position: property names, object
 * keys and JSX attribute names are not references. Shadowing is deliberately not resolved — a
 * local binding of the same name counts as a use, so the report errs toward keeping code.
 */
function referencesIn(node, names) {
  const found = new Set();
  walk(node, (n) => {
    if (n.type === 'MemberExpression' && !n.computed && n.property) skip.add(n.property);
    if (n.type === 'OptionalMemberExpression' && !n.computed && n.property) skip.add(n.property);
    if ((n.type === 'ObjectProperty' || n.type === 'ObjectMethod' || n.type === 'ClassMethod') &&
        !n.computed && n.key) skip.add(n.key);
    if (n.type === 'JSXAttribute' && n.name) skip.add(n.name);
    if (n.type === 'JSXMemberExpression' && n.property) skip.add(n.property);
    if (n.type === 'FunctionDeclaration' && n.id) skip.add(n.id);
    if ((n.type === 'Identifier' || n.type === 'JSXIdentifier') && !skip.has(n) &&
        names.has(n.name)) found.add(n.name);
  });
  skip = new WeakSet();
  return found;
}
let skip = new WeakSet();

/**
 * Which top-level bindings are reachable, given a set removed from the file. Roots are the module's
 * exports and its bare statements; from there it is a transitive walk, so a helper whose only user
 * was itself dropped drops too.
 */
function reachable(ast, removedNames) {
  const { rows, roots } = topLevel(ast);
  const removed = new Set(removedNames);
  const live = rows.filter((r) => !removed.has(r.name));
  const names = new Set(live.map((r) => r.name));
  const byName = new Map(live.map((r) => [r.name, r]));

  const seen = new Set();
  const queue = [];
  const push = (set) => { for (const n of set) if (!seen.has(n)) { seen.add(n); queue.push(n); } };

  for (const root of roots) push(referencesIn(root, names));
  for (const r of live) if (r.exported) push(new Set([r.name]));
  // The classic JSX transform compiles every element to `React.createElement`, so a file with any
  // JSX in it uses its React import whether or not the name appears. Reporting it as dangling
  // would have someone delete the one import the build cannot do without.
  if (names.has('React')) {
    let hasJsx = false;
    walk(ast, (n) => { if (n.type === 'JSXElement' || n.type === 'JSXFragment') hasJsx = true; });
    if (hasJsx) push(new Set(['React']));
  }
  while (queue.length) {
    const row = byName.get(queue.pop());
    // An import declares a name and uses none — and its `decl` is the whole statement, so scanning
    // it would make every specifier in that statement look like a user of its siblings.
    if (row && row.kind !== 'import') push(referencesIn(row.decl, names));
  }
  return { rows, live, byName, seen };
}

// ---------- inventory ----------

const NORM = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** `{IMG + "figure.png"}`, `"/images/figure.png"` and `IMG + "figure.png"` all resolve. */
function srcValue(attrValue) {
  if (!attrValue) return null;
  const expr = attrValue.type === 'JSXExpressionContainer' ? attrValue.expression : attrValue;
  if (!expr) return null;
  if (expr.type === 'StringLiteral') return expr.value;
  if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0)
    return expr.quasis.map((q) => q.value.cooked).join('');
  if (expr.type === 'BinaryExpression' && expr.operator === '+') {
    const left = expr.left.type === 'Identifier' ? expr.left.name : null;
    const right = srcValue(expr.right);
    if (right === null) return null;
    if (left === 'IMG') return `/images/${right}`;
    if (left === 'VID') return `/videos/${right}`;
    const l = srcValue(expr.left);
    return l === null ? null : l + right;
  }
  return null;
}

const attr = (el, name) => {
  const open = el.openingElement || el;
  return (open.attributes || []).find(
    (a) => a.type === 'JSXAttribute' && a.name && a.name.name === name,
  );
};

const elementName = (el) => {
  const n = (el.openingElement || el).name;
  return n && n.type === 'JSXIdentifier' ? n.name : null;
};

/** `const [sigma, setSigma] = useState(...)` anywhere in the file. */
function stateHooks(ast) {
  const hooks = [];
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || !n.init) return;
    const call = n.init;
    if (call.type !== 'CallExpression' || !call.callee || call.callee.type !== 'Identifier') return;
    if (call.callee.name !== 'useState') return;
    if (!n.id || n.id.type !== 'ArrayPattern') return;
    const [state, setter] = n.id.elements;
    if (!state || state.type !== 'Identifier') return;
    hooks.push({ state: state.name, setter: setter && setter.type === 'Identifier' ? setter.name : null });
  });
  return hooks;
}

function objectKeys(node) {
  if (!node || node.type !== 'ObjectExpression') return [];
  const keys = [];
  for (const p of node.properties) {
    if (p.type !== 'ObjectProperty' && p.type !== 'ObjectMethod') continue;
    if (p.computed) continue;
    if (p.key.type === 'Identifier') keys.push(p.key.name);
    else if (p.key.type === 'StringLiteral') keys.push(p.key.value);
  }
  return keys;
}

/** The `DEFAULT_GRAPH_PARAMS.<key>` a component reads, which is its key by construction. */
function paramsKeyOf(fnNode) {
  let key = null;
  walk(fnNode, (n) => {
    if (key || n.type !== 'MemberExpression') return;
    if (!n.object || n.object.type !== 'Identifier') return;
    if (n.object.name !== 'DEFAULT_GRAPH_PARAMS') return;
    if (!n.computed && n.property.type === 'Identifier') key = n.property.name;
    else if (n.computed && n.property.type === 'StringLiteral') key = n.property.value;
  });
  return key;
}

/** `<LiveGraph graphKey="waveGraph">` wrapping a call to <Name/>: the key the call site declares. */
function graphKeysByComponent(ast) {
  const found = new Map();
  walk(ast, (n) => {
    if (n.type !== 'JSXElement' || elementName(n) !== 'LiveGraph') return;
    const a = attr(n, 'graphKey');
    const key = a && srcValue(a.value);
    if (!key) return;
    walk(n, (c) => {
      if (c.type === 'JSXElement' || c.type === 'JSXOpeningElement') {
        const name = elementName(c);
        if (name && /^[A-Z]/.test(name) && name !== 'LiveGraph' && !found.has(name))
          found.set(name, key);
      }
    });
  });
  return found;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile()).map((d) => d.name).sort();
  } catch (e) {
    return [];
  }
}

/**
 * Is this `.py` the source of one of the videos the lesson references? Three kinds of evidence,
 * checked in order; the stem alone is no longer trusted on its own because manim names its output
 * after the Scene class, not the script.
 */
function pairManim(pyPath, videoStems) {
  const stem = path.basename(pyPath, '.py');
  if (videoStems.has(NORM(stem))) return { video: videoStems.get(NORM(stem)), evidence: 'stem' };
  let text = '';
  try {
    text = fs.readFileSync(pyPath, 'utf8');
  } catch (e) {
    return null;
  }
  for (const m of text.matchAll(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
    const hit = videoStems.get(NORM(m[1]));
    if (hit) return { video: hit, evidence: 'scene-class' };
  }
  for (const [, video] of videoStems) {
    if (text.includes(path.basename(video))) return { video, evidence: 'filename-in-source' };
  }
  return null;
}

function cmdInventory(flags) {
  const lessonRoot = flags.lesson ? path.resolve(flags.lesson) : null;
  if (!lessonRoot) die('--lesson <lesson_root> is required');
  if (!fs.existsSync(lessonRoot)) die(`no lesson root at ${lessonRoot}`);
  const file = flags.file ? path.resolve(flags.file) : lessonFile(lessonRoot);
  const code = read(file);
  const ast = parse(loadParser(lessonRoot), code, file);

  const { rows } = topLevel(ast);
  const names = new Set(rows.map((r) => r.name));
  const usedBy = new Map(rows.map((r) => [r.name, []]));
  for (const r of rows) {
    if (r.kind === 'import') continue; // see the note in reachable()
    for (const ref of referencesIn(r.decl, names)) if (ref !== r.name) usedBy.get(ref).push(r.name);
  }
  const callSiteKeys = graphKeysByComponent(ast);
  const defaults = rows.find((r) => r.name === 'DEFAULT_GRAPH_PARAMS');
  const schema = rows.find((r) => r.name === 'GRAPH_SCHEMA');
  const defaultKeys = defaults ? objectKeys(defaults.node) : [];
  const schemaKeys = schema ? objectKeys(schema.node) : [];

  const entry = (kind, node, extra) =>
    Object.assign(
      { kind, source_file: file, line_range: lineRange(node), purpose: null },
      extra,
    );

  const graph_components = [];
  const lesson_helpers = [];
  const ref_img_constants = [];
  for (const r of rows) {
    if (r.kind === 'import') continue;
    if (r.fn && isGraphSignature(r.fn)) {
      const key = paramsKeyOf(r.fn) || callSiteKeys.get(r.name) || null;
      graph_components.push(
        entry('svg-graph', r.decl, {
          name: r.name,
          default_params_key: key,
          graph_schema_key: key && schemaKeys.includes(key) ? key : null,
        }),
      );
    } else if (r.fn && !r.exported) {
      // Not a medium, so no `purpose`: a helper is lesson code the media entries lean on.
      lesson_helpers.push({
        name: r.name,
        kind: 'lesson-helper',
        source_file: file,
        line_range: lineRange(r.decl),
        used_by: usedBy.get(r.name),
      });
    } else if (r.kind === 'const' && /^IMG_[A-Z0-9_]+$/.test(r.name) &&
               r.node && (r.node.type === 'StringLiteral' || r.node.type === 'TemplateLiteral')) {
      ref_img_constants.push(entry('matplotlib-ref', r.decl, { name: r.name }));
    }
  }

  const static_images = [];
  const videos = [];
  const interactive_demos = [];
  const hooks = stateHooks(ast);
  walk(ast, (n) => {
    if (n.type !== 'JSXElement') return;
    const name = elementName(n);
    const tag = n.openingElement;
    if (name === 'img' || name === 'video') {
      const a = attr(n, 'src');
      const src = a ? srcValue(a.value) : null;
      if (!src) return;
      const rel = src.replace(/^\//, '');
      const row = entry(name === 'img' ? 'static-image' : 'manim-video', tag, {
        src,
        resolved_path: path.join(lessonRoot, 'public', rel),
      });
      (name === 'img' ? static_images : videos).push(row);
    } else if (name === 'InteractiveDemo') {
      const a = attr(n, 'title');
      const title = a ? srcValue(a.value) : null;
      const inside = new Set();
      walk(n, (c) => { if (c.type === 'Identifier' || c.type === 'JSXIdentifier') inside.add(c.name); });
      interactive_demos.push(
        entry('interactive-demo', n, {
          title,
          state_hooks: hooks
            .filter((h) => inside.has(h.state) || (h.setter && inside.has(h.setter)))
            .map((h) => h.state),
        }),
      );
    }
  });

  // Files on disk. The video rows carry the source that was proved to render them; a `.py` with no
  // such evidence, and an image or video no JSX reference resolves to, are the orphans.
  const videoStems = new Map();
  for (const v of videos) videoStems.set(NORM(path.basename(v.src, path.extname(v.src))), v.src);
  const manim_scripts = listDir(lessonRoot).filter((f) => f.endsWith('.py'))
    .map((f) => path.join(lessonRoot, f));
  const orphans = [];
  for (const py of manim_scripts) {
    const pair = pairManim(py, videoStems);
    if (pair) {
      const row = videos.find((v) => v.src === pair.video);
      row.manim_source = py;
      row.manim_source_evidence = pair.evidence;
    } else {
      orphans.push({ path: py, reason: 'no video in the JSX is rendered by this source' });
    }
  }
  for (const v of videos) if (!v.manim_source) { v.manim_source = null; v.manim_source_evidence = null; }
  for (const sub of ['images', 'videos']) {
    const dir = path.join(lessonRoot, 'public', sub);
    const referenced = new Set(
      (sub === 'images' ? static_images : videos).map((r) => r.resolved_path),
    );
    for (const f of listDir(dir)) {
      const p = path.join(dir, f);
      if (!referenced.has(p)) orphans.push({ path: p, reason: 'no src= in the JSX resolves to it' });
    }
  }

  out(JSON.stringify({
    lesson_file: file,
    lesson_root: lessonRoot.endsWith(path.sep) ? lessonRoot : lessonRoot + path.sep,
    graph_components,
    lesson_helpers,
    default_graph_params_keys: defaultKeys,
    graph_schema_keys: schemaKeys,
    graph_schema_backfill_needed: !schema,
    ref_img_constants,
    static_images,
    videos,
    interactive_demos,
    manim_scripts,
    orphans,
  }, null, 2));
}

// ---------- reachability ----------

function cmdReachability(flags) {
  const file = requireFile(flags);
  const code = read(file);
  const ast = parse(loadParser(path.resolve(path.dirname(file), '..')), code, file);
  const removing = list(flags, 'removing').flatMap((v) => v.split(',')).map((s) => s.trim())
    .filter(Boolean);

  const before = reachable(ast, []);
  for (const name of removing)
    if (!before.byName.has(name)) die(`no top-level declaration named ${name} in ${file}`, 3);
  const after = reachable(ast, removing);

  const unreachable = after.live
    .filter((r) => !after.seen.has(r.name))
    .map((r) => ({
      name: r.name,
      kind: r.kind === 'import' ? 'import' : isGraphSignature(r.fn) ? 'svg-graph'
            : r.fn ? 'lesson-helper' : 'const',
      // An import's own specifier, not the whole `import { … } from "@core"` statement it shares
      // with the specifiers that are still used.
      line_range: lineRange(r.kind === 'import' ? r.node : r.decl),
      // Was it reachable before this removal? If so the removal is what stranded it.
      reason: before.seen.has(r.name) ? `stranded by removing ${removing.join(', ')}`
                                      : 'already unreachable from the module exports',
    }));
  out(JSON.stringify({ file, removing, unreachable }, null, 2));
}

// ---------- digest ----------

/**
 * The SHA-256 of one named thing's own source bytes. A top-level declaration is hashed as the
 * statement a splice would cut out — the `export` wrapper included — and a demo as its
 * `<InteractiveDemo>` element, so the digest changes when and only when that thing's text does.
 * A name that is both is the declaration: a demo title is prose and does not collide with one.
 */
function cmdDigest(flags) {
  const file = requireFile(flags);
  const code = read(file);
  const ast = parse(loadParser(path.resolve(path.dirname(file), '..')), code, file);
  const rows = topLevel(ast).rows;
  const names = list(flags, 'name');
  if (!names.length) die('name what to hash: --name <declaration or demo title>');

  const digests = {};
  const missing = [];
  for (const name of names) {
    const row = rows.find((r) => r.name === name);
    let node = row ? row.decl : null;
    if (!node)
      walk(ast, (n) => {
        if (node || n.type !== 'JSXElement' || elementName(n) !== 'InteractiveDemo') return;
        const a = attr(n, 'title');
        if (a && srcValue(a.value) === name) node = n;
      });
    if (!node) missing.push(name);
    else digests[name] = crypto.createHash('sha256').update(code.slice(node.start, node.end)).digest('hex');
  }
  // Every name is answered in one pass — the ones that are there, and the ones that are not — so a
  // caller asking about six names in a file does not have to ask again once per name to find out
  // which one is gone. The exit code still says a target matched nothing.
  out(JSON.stringify({ file, digests, missing }));
  if (missing.length)
    die(`no top-level declaration or <InteractiveDemo title="..."> named ${missing.join(', ')} in ${file}`, 3);
}

// ---------- splice ----------

/** Resolve every `<target>` flag to one node, or exit 3 saying which one matched nothing. */
function resolveTargets(ast, flags, file) {
  const { rows } = topLevel(ast);
  const targets = [];
  const byName = (name, kinds, label) => {
    const row = rows.find((r) => r.name === name && kinds.includes(r.kind));
    if (!row) die(`${label} ${name} is not declared at the top level of ${file}`, 3);
    return { label: `${label}:${name}`, node: row.decl, statement: true };
  };
  for (const name of list(flags, 'component')) targets.push(byName(name, ['function', 'const'], 'component'));
  for (const name of list(flags, 'constant')) targets.push(byName(name, ['const'], 'constant'));

  for (const title of list(flags, 'demo')) {
    let hit = null;
    walk(ast, (n) => {
      if (hit || n.type !== 'JSXElement' || elementName(n) !== 'InteractiveDemo') return;
      const a = attr(n, 'title');
      if (a && srcValue(a.value) === title) hit = n;
    });
    if (!hit) die(`no <InteractiveDemo title="${title}"> in ${file}`, 3);
    targets.push({ label: `demo:${title}`, node: hit, statement: false });
  }

  for (const name of list(flags, 'call-site')) {
    const hits = [];
    walk(ast, (n, parent) => {
      if (n.type !== 'JSXElement' || elementName(n) !== name) return;
      // Every graph call site is wrapped in `<LiveGraph graphKey renderId>`. When the wrapper holds
      // nothing but this call, it goes with it rather than staying behind empty.
      const wrapper =
        parent && parent.type === 'JSXElement' && elementName(parent) === 'LiveGraph' &&
        parent.children.filter((c) => c.type === 'JSXElement' || c.type === 'JSXFragment').length === 1;
      hits.push(wrapper ? parent : n);
    });
    if (!hits.length) die(`no <${name}> call site in ${file}`, 3);
    for (const node of hits) targets.push({ label: `call-site:${name}`, node, statement: false });
  }

  for (const [flag, holder] of [['params-key', 'DEFAULT_GRAPH_PARAMS'], ['schema-key', 'GRAPH_SCHEMA']]) {
    for (const key of list(flags, flag)) {
      const row = rows.find((r) => r.name === holder);
      if (!row) die(`${holder} is not declared in ${file}`, 3);
      const prop = (row.node.type === 'ObjectExpression' ? row.node.properties : []).find(
        (p) => !p.computed && p.key &&
               (p.key.name === key || p.key.value === key),
      );
      if (!prop) die(`${holder} has no entry ${key} in ${file}`, 3);
      targets.push({ label: `${flag}:${key}`, node: prop, statement: false, property: row.node });
    }
  }
  if (!targets.length)
    die('name what to splice: --component, --constant, --demo, --params-key or --schema-key');
  return targets;
}

/**
 * The byte range a removal takes: the node, the line indentation in front of it, its own trailing
 * comma when it is an object entry, the comment lines attached above it, and the newline after.
 * Whatever sits outside that range is not touched.
 */
function removalRange(code, target) {
  let start = target.node.start;
  let end = target.node.end;

  if (target.property) {
    // An object entry owns its separating comma: the one after it, or the one before it when it
    // is the last entry, so the object never ends `a: 1,,` or `a: 1, }` with a stray comma.
    let i = end;
    while (i < code.length && /[ \t]/.test(code[i])) i++;
    if (code[i] === ',') end = i + 1;
    else {
      let j = start - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      if (code[j] === ',') start = j;
    }
  }

  const comments = target.node.leadingComments || [];
  let firstLine = target.node.loc.start.line;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (c.loc.end.line !== firstLine - 1) break;
    if (!/^\s*$/.test(code.slice(c.end, start).replace(/[^\S\n]/g, ''))) {
      // only whitespace may sit between the comment and what it documents
      if (code.slice(c.end, start).trim() !== '') break;
    }
    start = c.start;
    firstLine = c.loc.start.line;
  }

  let lineStart = code.lastIndexOf('\n', start - 1) + 1;
  if (/^[ \t]*$/.test(code.slice(lineStart, start))) start = lineStart;
  let i = end;
  while (i < code.length && /[ \t]/.test(code[i])) i++;
  if (code[i] === '\n') end = i + 1;

  // A declaration with a blank line on each side would leave the two touching. One of them belongs
  // to the removal, so it is inside the range the receipt reports — never a separate pass over the
  // file, which would also reflow blank lines the splice never named.
  const blankBefore = code[start - 1] === '\n' && code[start - 2] === '\n';
  if (blankBefore && code[end] === '\n') end += 1;
  return [start, end];
}

function splice(code, edits) {
  // Back to front, so an earlier edit never moves a later one's offsets.
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let text = code;
  for (const e of ordered) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

/** Every top-level binding's own source text, keyed by name. */
function declarationTexts(ast, code) {
  const texts = new Map();
  for (const r of topLevel(ast).rows) texts.set(r.name, code.slice(r.decl.start, r.decl.end));
  return texts;
}

/**
 * The top-level declarations the targets are entitled to change. A target inside one — a demo in
 * `LessonApp`, a key in `DEFAULT_GRAPH_PARAMS` — names the declaration that contains it.
 */
function touchedNames(ast, targets) {
  const rows = topLevel(ast).rows;
  const named = new Set();
  for (const t of targets)
    for (const r of rows)
      if (r.decl.start <= t.node.start && t.node.end <= r.decl.end) named.add(r.name);
  return named;
}

/**
 * The check that makes the receipt worth reading, and the one thing here that does not go through
 * the splice's own offset arithmetic: re-parse the result and compare each top-level declaration's
 * source text, by NAME, against the declaration of that name in the original parse. A range that
 * ran into its neighbour shows up as that neighbour changed or gone — which offsets compared
 * against the offsets that produced them can never show.
 */
function verifyDeclarations(beforeTexts, afterAst, afterText, touched) {
  const after = declarationTexts(afterAst, afterText);
  const changed = [];
  const removed = [];
  const added = [];
  let verified = 0;
  for (const [name, text] of beforeTexts) {
    if (touched.has(name)) continue;
    if (!after.has(name)) removed.push(name);
    else if (after.get(name) !== text) changed.push(name);
    else verified++;
  }
  for (const name of after.keys()) if (!beforeTexts.has(name)) added.push(name);
  return { verified_unchanged: verified, changed, removed, added };
}

function finish(flags, file, code, text, receipt, parser, before) {
  const afterAst = parseSpliced(parser, text, file);
  const declarations = verifyDeclarations(before.texts, afterAst, text, before.touched);
  const broken = [...declarations.changed, ...declarations.removed];
  if (broken.length)
    die(`the splice changed or removed a declaration no target named (${broken.join(', ')}) — nothing written`, 4);

  if (!flags.write) {
    process.stdout.write(text);
    return;
  }
  const part = `${file}.lesson-ast.part`;
  fs.writeFileSync(part, text);
  fs.renameSync(part, file);
  // The bytes the lesson now holds, read back rather than assumed: a write that did not land whole
  // is the one failure the in-memory checks above cannot see.
  const onDisk = read(file);
  if (onDisk !== text)
    die(`${file} does not hold the bytes the splice produced — the write did not land whole`);
  out(JSON.stringify(Object.assign(receipt, {
    bytes_before: Buffer.byteLength(code),
    bytes_after: Buffer.byteLength(text),
    bytes_on_disk: Buffer.byteLength(onDisk),
    declarations,
  }), null, 2));
}

// The result is parsed with the same parser the input was, and a failure is the splice's fault:
// exit 4 with the error, and nothing written.
function parseSpliced(parser, text, file) {
  try {
    return parser.parse(text, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    const at = e.loc ? `${e.loc.line}:${e.loc.column + 1}` : '';
    return die(`the spliced result does not parse (${file} ${at}: ${e.message}) — nothing written`, 4);
  }
}

function cmdReplace(flags) {
  const file = requireFile(flags);
  if (!flags.with) die('--with <file> is required: the replacement text');
  const code = read(file);
  const parser = loadParser(path.resolve(path.dirname(file), '..'));
  const ast = parse(parser, code, file);
  const targets = resolveTargets(ast, flags, file);
  if (targets.length !== 1)
    die(`replace takes one target, and these matched ${targets.length}: ${targets.map((t) => t.label).join(', ')}`);
  const t = targets[0];
  const text = read(path.resolve(flags.with)).replace(/\n+$/, '');
  const edit = { start: t.node.start, end: t.node.end, text };
  const before = { texts: declarationTexts(ast, code), touched: touchedNames(ast, targets) };
  finish(flags, file, code, splice(code, [edit]), {
    file,
    targets: [{
      target: t.label,
      line_range: lineRange(t.node),
      bytes_removed: edit.end - edit.start,
      bytes_inserted: Buffer.byteLength(text),
    }],
  }, parser, before);
}

function cmdRemove(flags) {
  const file = requireFile(flags);
  const code = read(file);
  const parser = loadParser(path.resolve(path.dirname(file), '..'));
  const ast = parse(parser, code, file);
  const targets = resolveTargets(ast, flags, file);
  const ranges = targets
    .map((t) => ({ t, range: removalRange(code, t) }))
    .sort((a, b) => a.range[0] - b.range[0]);
  // Two removals next to each other can have the blank line between them claimed by both. The
  // earlier one yields it, so no byte is deleted twice and every range still stands on its own.
  for (let i = 0; i < ranges.length - 1; i++)
    if (ranges[i].range[1] > ranges[i + 1].range[0]) ranges[i].range[1] = ranges[i + 1].range[0];

  const edits = ranges.map(({ range }) => ({ start: range[0], end: range[1], text: '' }));
  const rows = ranges.map(({ t, range }) => ({
    target: t.label,
    line_range: lineRange(t.node),
    bytes_removed: range[1] - range[0],
    bytes_inserted: 0,
  }));
  const before = { texts: declarationTexts(ast, code), touched: touchedNames(ast, targets) };
  finish(flags, file, code, splice(code, edits), { file, targets: rows }, parser, before);
}

// ---------- shared ----------

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return die(`cannot read ${file}: ${e.message}`);
  }
}

const out = (s) => process.stdout.write(`${s}\n`);

function requireFile(flags) {
  if (!flags.file) die('--file <lesson.jsx> is required');
  const file = path.resolve(flags.file);
  if (!fs.existsSync(file)) die(`no lesson file at ${file}`);
  return file;
}

/** `src/<slug>.jsx`, then the snake-cased slug the template scaffolds, then the only jsx in src/. */
function lessonFile(lessonRoot) {
  const slug = path.basename(lessonRoot);
  for (const name of [`${slug}.jsx`, `${slug.replace(/-/g, '_')}.jsx`]) {
    const p = path.join(lessonRoot, 'src', name);
    if (fs.existsSync(p)) return p;
  }
  const candidates = listDir(path.join(lessonRoot, 'src'))
    .filter((f) => f.endsWith('.jsx') && f !== 'main.jsx');
  if (candidates.length === 1) return path.join(lessonRoot, 'src', candidates[0]);
  return die(
    `cannot tell which file is the lesson in ${path.join(lessonRoot, 'src')} ` +
      `(${candidates.join(', ') || 'no .jsx files'}) — pass --file`,
  );
}

// ---------- main ----------

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  inventory: cmdInventory,
  reachability: cmdReachability,
  digest: cmdDigest,
  replace: cmdReplace,
  remove: cmdRemove,
};
if (!cmd || !commands[cmd]) {
  process.stderr.write(
    `usage: lesson-ast.cjs <${Object.keys(commands).join('|')}> [...]\n` +
      'see the header of this file, references/phase-1-content.md § Existing-media inventory, ' +
      'or references/phase-3-execution.md § Step 4\n',
  );
  process.exit(1);
}
commands[cmd](parseArgs(rest));
