import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { lessonChatProxy } from "../../../_lesson-core/server/viteLessonProxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // lessonChatProxy forwards /chat, /session, /sessions, /upload and /commit
  // to THIS lesson's Express proxy, resolving it per request from
  // server/.proxy.json. It replaces a `server.proxy` entry that pinned a port
  // number read once at config load: every lesson's proxy starts its search at
  // 3001, so a number that has gone stale still answers — from another
  // lesson's backend, with another lesson's chat sessions and working
  // directory. See _lesson-core/server/viteLessonProxy.js.
  plugins: [react(), lessonChatProxy(__dirname)],
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "../../../_lesson-core"),
    },
  },
  // Load .env.local from the WORKSPACE ROOT so one key file (VITE_DESMOS_KEY)
  // serves every lesson. Vite does NOT walk upward on its own — without this,
  // a root .env.local is silently ignored and Desmos reports a missing key.
  envDir: path.resolve(__dirname, "../../.."),
  server: {
    fs: { allow: ["..", "../..", "../../..", "../../../.."] },
  },
});
