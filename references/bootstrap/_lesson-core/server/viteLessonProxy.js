// Vite dev-server middleware that forwards the tutor's HTTP routes to THIS
// lesson's Express proxy, and refuses to forward them anywhere else.
//
// Why not Vite's built-in `server.proxy`: vite.config.js is evaluated once, at
// startup, so a port read there is frozen for the life of the dev server. The
// proxy picks its port at runtime — 3001, incrementing past whatever is
// already bound — so that number goes stale as soon as the proxy restarts
// somewhere else. A stale port is not merely dead: every lesson's proxy starts
// its search at 3001, so the number almost always still answers, just from a
// different lesson. Chat then reaches the wrong backend, which offers the
// wrong lesson's resumable sessions and runs the CLI with the wrong lesson as
// its cwd and --add-dir.
//
// So the target is resolved per request from `server/.proxy.json`, which
// records identity (lessonDir, pid) rather than a bare number, and two
// independent checks have to pass:
//
//   1. Locally — the record names this lesson's realpath and its pid is still
//      alive. Catches the common cases: nothing running, a stale file left by
//      a killed proxy, a file written by the same lesson in another worktree.
//   2. On the wire — every forwarded request carries X-Expect-Lesson-Dir, and
//      the proxy rejects it with 409 unless it matches its own directory.
//      Check 1 alone can be fooled by a recycled pid or by a proxy that died
//      between the file read and the connect; this closes both, and it costs
//      no extra round trip.
//
// When resolution fails the request gets a 503 whose JSON body matches the
// shape the chat client already surfaces ({error:{message}}), so the student
// reads what is wrong instead of watching the tutor talk to another lesson.
import fs from "fs";
import path from "path";
import http from "http";

// Every Express route the chat client calls. A route missing here is served
// Vite's index.html instead, which the client parses as a failed API call.
const ROUTES = ["/chat", "/upload", "/session", "/sessions", "/commit"];

// Hop-by-hop headers belong to a single connection and must not be relayed:
// passing `transfer-encoding` through would fight Node's own framing on the
// downstream response, which is exactly the SSE stream /chat depends on.
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

const realpathOf = (p) => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };

const isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  // Signal 0 performs the permission and existence checks without delivering
  // anything. EPERM means the pid exists but belongs to another user.
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
};

export function lessonChatProxy(lessonDir) {
  const LESSON_DIR = realpathOf(lessonDir);
  const IDENT_FILE = path.join(lessonDir, "server", ".proxy.json");
  const name = path.basename(LESSON_DIR);

  // Read fresh every request: the file is a few bytes on local disk, and
  // caching it would reintroduce the very staleness this exists to prevent.
  function resolveTarget() {
    let raw;
    try {
      raw = fs.readFileSync(IDENT_FILE, "utf8");
    } catch (_) {
      return { error: `The tutor backend for "${name}" is not running. Start it with \`npm run proxy\` in the lesson directory, then reload.` };
    }
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch (_) {
      return { error: `The tutor backend record for "${name}" (server/.proxy.json) is unreadable. Delete it and restart the proxy with \`npm run proxy\`.` };
    }
    if (rec.lessonDir !== LESSON_DIR) {
      return { error: `Refusing to send this chat to another lesson's tutor: server/.proxy.json was written by ${rec.lessonDir}, not by this lesson (${LESSON_DIR}). Delete that file and start this lesson's own proxy.` };
    }
    if (!isAlive(rec.pid)) {
      return { error: `The tutor backend for "${name}" is not running — server/.proxy.json is stale (pid ${rec.pid} exited without cleaning up). Start it with \`npm run proxy\`.` };
    }
    if (!Number.isInteger(rec.port)) {
      return { error: `The tutor backend record for "${name}" names no port. Delete server/.proxy.json and restart the proxy.` };
    }
    return { port: rec.port };
  }

  function fail(res, status, message) {
    if (res.headersSent) { res.end(); return; }
    const body = JSON.stringify({ error: { message } });
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  }

  function forward(req, res, port) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    }
    headers.host = `127.0.0.1:${port}`;
    headers["x-expect-lesson-dir"] = LESSON_DIR;

    const upstream = http.request(
      { host: "127.0.0.1", port, path: req.url, method: req.method, headers },
      (up) => {
        const out = {};
        for (const [k, v] of Object.entries(up.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
        }
        res.writeHead(up.statusCode || 502, out);
        // /chat is a server-sent-event stream that must reach the browser
        // token by token; without these the reply only appears once the CLI
        // has finished and the socket flushes.
        if (typeof res.flushHeaders === "function") res.flushHeaders();
        if (res.socket) res.socket.setNoDelay(true);
        up.pipe(res);
      },
    );
    // A tutor turn can legitimately run for many minutes (the proxy allows 30);
    // no timeout may cut the stream short.
    upstream.setTimeout(0);
    upstream.on("error", (err) => {
      fail(res, 502, `Cannot reach the tutor backend for "${name}" on port ${port} (${err.code || err.message}). It may have just stopped — restart it with \`npm run proxy\`.`);
    });
    // Mirror the old http-proxy behaviour on a client disconnect (HMR reload,
    // closed tab): drop our end. The proxy deliberately lets the CLI run on,
    // and keeps the result in the session for the next message.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }

  return {
    name: "lesson-chat-proxy",
    configureServer(server) {
      // Registered inside configureServer without the returned-function form,
      // so it runs BEFORE Vite's own middlewares — otherwise the SPA fallback
      // answers /chat with index.html.
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        const matched = ROUTES.some((r) => url === r || url.startsWith(`${r}/`) || url.startsWith(`${r}?`));
        if (!matched) return next();
        const target = resolveTarget();
        if (target.error) return fail(res, 503, target.error);
        forward(req, res, target.port);
      });
    },
  };
}
